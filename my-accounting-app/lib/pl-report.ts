import type { SupabaseClient } from '@supabase/supabase-js'

// ── 월별 손익현황 (경영관리용) ───────────────────────────
// ERP 주문 기준 매출/매출원가 + 은행거래(비용 계정 분류분) 운영비를 월별로 집계한다.
// 법인카드 매입/급여/감가상각비는 현재 데이터가 없어 "미반영" 항목으로 표시하되,
// 추후 데이터 업로드 시 채워질 수 있도록 행 구조를 유지한다.

export interface PLLineItem {
  key: string
  label: string
  is_placeholder: boolean  // true: 데이터 미반영 (향후 업로드 예정)
  is_subtotal: boolean     // true: 계산된 합계/이익 행
  values: number[]         // months와 동일한 길이
}

export interface MonthlyPLResult {
  months: string[]   // 'YYYY-MM'
  items: PLLineItem[]
}

function monthRange(from: string, to: string): string[] {
  const result: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ey, em] = to.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return result
}

function lastDayOfMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function buildMonthlyPL(
  admin: SupabaseClient,
  from: string,  // 'YYYY-MM'
  to: string,    // 'YYYY-MM'
): Promise<{ result: MonthlyPLResult } | { error: string }> {
  const months = monthRange(from, to)
  const dateFrom = `${from}-01`
  const dateTo = lastDayOfMonth(to)

  // ── ERP 매출/매출원가: 주문일 기준 월별 집계 (취소/VIP/선결제 제외) ──
  const { data: orders, error: oe } = await admin
    .from('erp_orders')
    .select('id, order_date')
    .gte('order_date', dateFrom)
    .lte('order_date', dateTo)
    .limit(50000)
  if (oe) return { error: oe.message }

  const monthByOrder = new Map((orders ?? []).map(o => [o.id as string, (o.order_date as string).slice(0, 7)]))
  const orderIds = (orders ?? []).map(o => o.id as string)

  const revenueByMonth = new Map<string, number>()
  const cogsByMonth = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data: items, error: ie } = await admin
      .from('erp_order_items')
      .select('order_id, line_total, purchase_total')
      .in('order_id', orderIds.slice(i, i + 500))
      .eq('is_canceled', false)
      .eq('is_vip', false)
      .eq('is_prepayment', false)
    if (ie) return { error: ie.message }
    for (const it of items ?? []) {
      const month = monthByOrder.get(it.order_id as string)
      if (!month) continue
      revenueByMonth.set(month, (revenueByMonth.get(month) ?? 0) + ((it.line_total as number) || 0))
      cogsByMonth.set(month, (cogsByMonth.get(month) ?? 0) + ((it.purchase_total as number) || 0))
    }
  }

  // ── 기타 운영비: 은행거래 중 비용(expense) 계정으로 확정 분류된 출금 ──
  const { data: expenseAccounts, error: eae } = await admin
    .from('accounts')
    .select('id')
    .eq('type', 'expense')
  if (eae) return { error: eae.message }
  const expenseIds = (expenseAccounts ?? []).map(a => a.id as string)

  const opexByMonth = new Map<string, number>()
  for (let i = 0; i < expenseIds.length; i += 200) {
    const { data: txs, error: te } = await admin
      .from('transactions')
      .select('tx_date, amount_out')
      .in('confirmed_account_id', expenseIds.slice(i, i + 200))
      .gte('tx_date', dateFrom)
      .lte('tx_date', dateTo)
      .limit(200000)
    if (te) return { error: te.message }
    for (const t of txs ?? []) {
      const month = (t.tx_date as string).slice(0, 7)
      opexByMonth.set(month, (opexByMonth.get(month) ?? 0) + ((t.amount_out as number) || 0))
    }
  }

  const revenue = months.map(m => revenueByMonth.get(m) ?? 0)
  const cogs    = months.map(m => cogsByMonth.get(m) ?? 0)
  const grossProfit = months.map((_, i) => revenue[i] - cogs[i])
  const sgaCard         = months.map(() => 0)
  const sgaSalary       = months.map(() => 0)
  const sgaDepreciation = months.map(() => 0)
  const sgaOther        = months.map(m => opexByMonth.get(m) ?? 0)
  const sgaTotal = months.map((_, i) => sgaCard[i] + sgaSalary[i] + sgaDepreciation[i] + sgaOther[i])
  const operatingProfit = months.map((_, i) => grossProfit[i] - sgaTotal[i])

  const items: PLLineItem[] = [
    { key: 'revenue',          label: '매출',            is_placeholder: false, is_subtotal: false, values: revenue },
    { key: 'cogs',              label: '매출원가',        is_placeholder: false, is_subtotal: false, values: cogs },
    { key: 'gross_profit',      label: '매출이익',        is_placeholder: false, is_subtotal: true,  values: grossProfit },
    { key: 'sga_card',          label: '법인카드 매입',   is_placeholder: true,  is_subtotal: false, values: sgaCard },
    { key: 'sga_salary',        label: '급여',            is_placeholder: true,  is_subtotal: false, values: sgaSalary },
    { key: 'sga_depreciation',  label: '감가상각비',      is_placeholder: true,  is_subtotal: false, values: sgaDepreciation },
    { key: 'sga_other',         label: '기타 운영비(은행거래)', is_placeholder: false, is_subtotal: false, values: sgaOther },
    { key: 'sga_total',         label: '판매관리비 합계', is_placeholder: false, is_subtotal: true,  values: sgaTotal },
    { key: 'operating_profit',  label: '영업이익',        is_placeholder: false, is_subtotal: true,  values: operatingProfit },
  ]

  return { result: { months, items } }
}
