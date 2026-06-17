import type { SupabaseClient } from '@supabase/supabase-js'

// ── 월별 손익현황 (경영관리용) ───────────────────────────
// ERP 주문 기준 매출/매출원가 + 매입세금계산서 계정과목 분류분 + 은행거래 계정과목 분류분을
// 월별로 집계한다.

export interface PLLineItem {
  key: string
  label: string
  is_placeholder: boolean    // true: 데이터 미반영 (향후 업로드 예정)
  is_subtotal: boolean       // true: 계산된 합계/이익 행
  is_section_header: boolean // true: 섹션 구분 헤더 행
  values: number[]           // months와 동일한 길이
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
  from: string,
  to: string,
): Promise<{ result: MonthlyPLResult } | { error: string }> {
  const months = monthRange(from, to)
  const dateFrom = `${from}-01`
  const dateTo = lastDayOfMonth(to)

  // 1. ERP 매출·매출원가 (기존 RPC 유지)
  const { data: plRows, error: pe } = await admin
    .rpc('monthly_pl_order_summary', { p_from: dateFrom, p_to: dateTo })
  if (pe) return { error: pe.message }

  // 2. 매입세금계산서 계정과목별 월별 합계 (신규 RPC)
  const { data: tiRows, error: tie } = await admin
    .rpc('monthly_pl_tax_invoice_summary', { p_from: dateFrom, p_to: dateTo })
  if (tie) return { error: tie.message }

  // 3. 은행 거래 계정과목별 월별 합계 (신규 RPC - 기존 청크 방식 대체)
  const { data: txRows, error: txe } = await admin
    .rpc('monthly_pl_tx_account_summary', { p_from: dateFrom, p_to: dateTo })
  if (txe) return { error: txe.message }

  // 4. 계정 코드 조회 (code → id 매핑)
  const { data: accountList, error: ae } = await admin
    .from('accounts')
    .select('id, code')
    .not('code', 'is', null)
  if (ae) return { error: ae.message }
  const codeToId = new Map((accountList ?? []).map(a => [a.code as string, a.id as string]))

  // 5. 월별·계정별 집계 맵 구성
  const tiByAccMonth = new Map<string, Map<string, number>>()
  for (const r of tiRows ?? []) {
    const accId = r.account_id as string
    if (!tiByAccMonth.has(accId)) tiByAccMonth.set(accId, new Map())
    tiByAccMonth.get(accId)!.set(r.month as string, (r.amount as number) || 0)
  }

  const txInByAccMonth  = new Map<string, Map<string, number>>()
  const txOutByAccMonth = new Map<string, Map<string, number>>()
  for (const r of txRows ?? []) {
    const accId = r.account_id as string
    if (!txInByAccMonth.has(accId))  txInByAccMonth.set(accId,  new Map())
    if (!txOutByAccMonth.has(accId)) txOutByAccMonth.set(accId, new Map())
    txInByAccMonth.get(accId)!.set(r.month as string,  (r.amount_in as number)  || 0)
    txOutByAccMonth.get(accId)!.set(r.month as string, (r.amount_out as number) || 0)
  }

  // 6. 계정코드로 월별 합계 계산하는 헬퍼
  const byCode = (code: string, source: 'ti' | 'tx_out' | 'tx_in' | 'both_out'): number[] => {
    const id = codeToId.get(code)
    if (!id) return months.map(() => 0)
    return months.map(m => {
      let total = 0
      if (source === 'ti' || source === 'both_out')
        total += tiByAccMonth.get(id)?.get(m) ?? 0
      if (source === 'tx_out' || source === 'both_out')
        total += txOutByAccMonth.get(id)?.get(m) ?? 0
      if (source === 'tx_in')
        total += txInByAccMonth.get(id)?.get(m) ?? 0
      return total
    })
  }

  // 7. ERP 집계 (기존과 동일)
  const revenueByMonth = new Map<string, number>()
  const cogsByMonth    = new Map<string, number>()
  for (const row of plRows ?? []) {
    revenueByMonth.set(row.month as string, (row.revenue as number) || 0)
    cogsByMonth.set(row.month as string,    (row.cogs   as number) || 0)
  }
  const revenue      = months.map(m => revenueByMonth.get(m) ?? 0)
  const cogs         = months.map(m => cogsByMonth.get(m)    ?? 0)
  const grossProfit  = months.map((_, i) => revenue[i] - cogs[i])

  // 8. 판관비 항목
  const sgaSalary       = months.map(() => 0)
  const sgaCard         = months.map(() => 0)
  const sgaTransport    = byCode('5201', 'ti')
  const sgaRent         = byCode('5109', 'both_out')
  const sgaComm         = byCode('5104', 'both_out')
  const sgaOutsource    = byCode('5202', 'ti')
  const sgaElectricity  = byCode('5203', 'ti')
  const sgaCleaning     = byCode('5204', 'ti')
  const sgaSecurity     = byCode('5205', 'ti')
  const sgaFee          = byCode('5108', 'both_out')
  const sgaSupplies     = byCode('5105', 'both_out')
  const sgaDepreciation = months.map(() => 0)
  const sgaOtherSga     = byCode('5206', 'ti')

  const sgaTotal = months.map((_, i) =>
    sgaSalary[i] + sgaCard[i] + sgaTransport[i] + sgaRent[i] +
    sgaComm[i] + sgaOutsource[i] + sgaElectricity[i] + sgaCleaning[i] +
    sgaSecurity[i] + sgaFee[i] + sgaSupplies[i] + sgaDepreciation[i] + sgaOtherSga[i]
  )
  const operatingProfit = months.map((_, i) => grossProfit[i] - sgaTotal[i])

  // 9. 영업외 항목
  const nonOpIntIn   = byCode('4002', 'tx_in')
  const nonOpMiscIn  = byCode('4003', 'tx_in')
  const nonOpIntOut  = byCode('5301', 'tx_out')
  const nonOpFinFee  = byCode('5302', 'tx_out')
  const nonOpMiscOut = byCode('5303', 'tx_out')

  const nonOpIncome  = months.map((_, i) => nonOpIntIn[i] + nonOpMiscIn[i])
  const nonOpExpense = months.map((_, i) => nonOpIntOut[i] + nonOpFinFee[i] + nonOpMiscOut[i])
  const pretaxProfit = months.map((_, i) => operatingProfit[i] + nonOpIncome[i] - nonOpExpense[i])
  const tax          = months.map(() => 0)
  const netProfit    = months.map((_, i) => pretaxProfit[i] - tax[i])

  // 10. items 배열 구성
  const items: PLLineItem[] = [
    { key: 'revenue',          label: '매출',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: revenue },
    { key: 'cogs',             label: '매출원가',          is_placeholder: false, is_subtotal: false, is_section_header: false, values: cogs },
    { key: 'gross_profit',     label: '매출이익',          is_placeholder: false, is_subtotal: true,  is_section_header: false, values: grossProfit },
    { key: 'sga_header',       label: '판매관리비',        is_placeholder: false, is_subtotal: false, is_section_header: true,  values: months.map(() => 0) },
    { key: 'sga_salary',       label: '급여',              is_placeholder: true,  is_subtotal: false, is_section_header: false, values: sgaSalary },
    { key: 'sga_card',         label: '법인카드 사용액',   is_placeholder: true,  is_subtotal: false, is_section_header: false, values: sgaCard },
    { key: 'sga_transport',    label: '운반비',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaTransport },
    { key: 'sga_rent',         label: '임차료',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaRent },
    { key: 'sga_comm',         label: '통신비',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaComm },
    { key: 'sga_outsource',    label: '외주용역비',         is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaOutsource },
    { key: 'sga_electricity',  label: '전기요금',           is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaElectricity },
    { key: 'sga_cleaning',     label: '청소비',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaCleaning },
    { key: 'sga_security',     label: '보안비',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaSecurity },
    { key: 'sga_fee',          label: '수수료',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaFee },
    { key: 'sga_supplies',     label: '소모품비',           is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaSupplies },
    { key: 'sga_depreciation', label: '감가상각비',         is_placeholder: true,  is_subtotal: false, is_section_header: false, values: sgaDepreciation },
    { key: 'sga_other_sga',    label: '기타판관비',         is_placeholder: false, is_subtotal: false, is_section_header: false, values: sgaOtherSga },
    { key: 'sga_total',        label: '판매관리비 합계',    is_placeholder: false, is_subtotal: true,  is_section_header: false, values: sgaTotal },
    { key: 'operating_profit', label: '영업이익',           is_placeholder: false, is_subtotal: true,  is_section_header: false, values: operatingProfit },
    { key: 'non_op_in_header', label: '영업외수익',         is_placeholder: false, is_subtotal: false, is_section_header: true,  values: months.map(() => 0) },
    { key: 'non_op_int_in',    label: '이자수익',           is_placeholder: false, is_subtotal: false, is_section_header: false, values: nonOpIntIn },
    { key: 'non_op_misc_in',   label: '잡이익',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: nonOpMiscIn },
    { key: 'non_op_out_header',label: '영업외비용',         is_placeholder: false, is_subtotal: false, is_section_header: true,  values: months.map(() => 0) },
    { key: 'non_op_int_out',   label: '이자비용',           is_placeholder: false, is_subtotal: false, is_section_header: false, values: nonOpIntOut },
    { key: 'non_op_fin_fee',   label: '금융수수료',         is_placeholder: false, is_subtotal: false, is_section_header: false, values: nonOpFinFee },
    { key: 'non_op_misc_out',  label: '잡손실',             is_placeholder: false, is_subtotal: false, is_section_header: false, values: nonOpMiscOut },
    { key: 'pretax_profit',    label: '법인세차감전순이익', is_placeholder: false, is_subtotal: true,  is_section_header: false, values: pretaxProfit },
    { key: 'tax',              label: '법인세',             is_placeholder: true,  is_subtotal: false, is_section_header: false, values: tax },
    { key: 'net_profit',       label: '당기순이익',         is_placeholder: false, is_subtotal: true,  is_section_header: false, values: netProfit },
  ]

  return { result: { months, items } }
}
