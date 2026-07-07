import type { SupabaseClient } from '@supabase/supabase-js'

// ── 월별 손익현황 (경영관리용) — 분개 기반 ───────────────────────
// 원칙 (2026-07 사장님 결정):
//   1. 매출·매출원가는 ERP 주문 기준 (취소·VIP·선결제 제외)
//   2. 매입성 계정(매출원가 5001·상품매입 5002)과 매출 세계 분개(4001)는
//      역할분리 계정 — 원장·채권채무 관리용으로 분개는 유지하되 손익에선 제외
//      (ERP 매출·원가가 그 자리를 대신한다. 4004는 legacy 계정으로 제외)
//   3. 나머지 수익·비용 계정은 분개(journal_lines) 집계로 동적 표시
//      → 법인카드·세금계산서·통장 등 원천과 무관하게 "확정→분개→손익"이 일치

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

// 손익에서 제외하는 역할분리 계정 (분개는 존재하되 ERP 수치가 대신함)
const EXCLUDED_CODES = new Set(['4001', '4004', '5001', '5002'])
// 영업외비용 코드 구간 (53xx) — 그 외 비용은 판매관리비
const isNonOpExpense = (code: string) => code.startsWith('53')

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
  const monthIdx = new Map(months.map((m, i) => [m, i]))

  // 1. ERP 매출·매출원가
  const { data: plRows, error: pe } = await admin
    .rpc('monthly_pl_order_summary', { p_from: dateFrom, p_to: dateTo })
  if (pe) return { error: pe.message }

  // 2. 분개 집계 (월 × 계정 × 차/대변)
  const { data: jRows, error: je } = await admin
    .rpc('monthly_pl_journal_summary', { p_from: dateFrom, p_to: dateTo })
  if (je) {
    return { error: `분개 집계 실패: ${je.message} — 058 마이그레이션(monthly_pl_journal_summary) 적용이 필요합니다.` }
  }

  // 3. 계정 마스터 (수익/비용 계정만 손익 대상)
  const { data: accountList, error: ae } = await admin
    .from('accounts')
    .select('id, code, name, type')
  if (ae) return { error: ae.message }
  const accounts = new Map((accountList ?? []).map(a => [
    a.id as string,
    { code: (a.code as string) ?? '', name: (a.name as string) ?? '', type: (a.type as string) ?? '' },
  ]))

  // 4. 계정별 월 순액: 수익 = 대변-차변, 비용 = 차변-대변
  const netByAcc = new Map<string, number[]>()
  for (const r of jRows ?? []) {
    const acc = accounts.get(r.account_id as string)
    if (!acc || (acc.type !== 'income' && acc.type !== 'expense')) continue
    if (EXCLUDED_CODES.has(acc.code)) continue
    const i = monthIdx.get(r.month as string)
    if (i === undefined) continue
    let arr = netByAcc.get(r.account_id as string)
    if (!arr) { arr = months.map(() => 0); netByAcc.set(r.account_id as string, arr) }
    const debit = (r.debit as number) || 0
    const credit = (r.credit as number) || 0
    arr[i] += acc.type === 'income' ? credit - debit : debit - credit
  }

  // 5. 섹션 분류 (코드순 정렬, 전월 0인 계정은 숨김)
  type Row = { code: string; name: string; values: number[] }
  const sga: Row[] = []
  const nonOpExp: Row[] = []
  const nonOpInc: Row[] = []
  for (const [accId, values] of Array.from(netByAcc.entries())) {
    const acc = accounts.get(accId)!
    if (values.every(v => v === 0)) continue
    const row = { code: acc.code, name: acc.name, values }
    if (acc.type === 'income') nonOpInc.push(row)
    else if (isNonOpExpense(acc.code)) nonOpExp.push(row)
    else sga.push(row)
  }
  const byCode = (a: Row, b: Row) => a.code.localeCompare(b.code)
  sga.sort(byCode); nonOpExp.sort(byCode); nonOpInc.sort(byCode)

  // 6. ERP 매출·원가
  const revenueByMonth = new Map<string, number>()
  const cogsByMonth = new Map<string, number>()
  for (const row of plRows ?? []) {
    revenueByMonth.set(row.month as string, (row.revenue as number) || 0)
    cogsByMonth.set(row.month as string, (row.cogs as number) || 0)
  }
  const revenue = months.map(m => revenueByMonth.get(m) ?? 0)
  const cogs = months.map(m => cogsByMonth.get(m) ?? 0)
  const grossProfit = months.map((_, i) => revenue[i] - cogs[i])

  const sum = (rows: Row[]) => months.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0))
  const sgaTotal = sum(sga)
  const nonOpIncome = sum(nonOpInc)
  const nonOpExpense = sum(nonOpExp)
  const operatingProfit = months.map((_, i) => grossProfit[i] - sgaTotal[i])
  const pretaxProfit = months.map((_, i) => operatingProfit[i] + nonOpIncome[i] - nonOpExpense[i])
  const tax = months.map(() => 0)
  const netProfit = months.map((_, i) => pretaxProfit[i] - tax[i])

  const zero = months.map(() => 0)
  const line = (key: string, label: string, values: number[], opt: Partial<PLLineItem> = {}): PLLineItem => ({
    key, label, values,
    is_placeholder: false, is_subtotal: false, is_section_header: false,
    ...opt,
  })

  const items: PLLineItem[] = [
    line('revenue', '매출 (ERP)', revenue),
    line('cogs', '매출원가 (ERP)', cogs),
    line('gross_profit', '매출이익', grossProfit, { is_subtotal: true }),
    line('sga_header', '판매관리비', zero, { is_section_header: true }),
    ...sga.map(r => line(`sga_${r.code}`, r.name, r.values)),
    // 급여·감가상각은 분개가 생기면 위 동적 목록에 자동 포함 — 없는 동안 미반영 표시
    ...(sga.some(r => r.code === '5101') ? [] : [line('sga_salary_ph', '급여', zero, { is_placeholder: true })]),
    ...(sga.some(r => r.code === '5112') ? [] : [line('sga_dep_ph', '감가상각비', zero, { is_placeholder: true })]),
    line('sga_total', '판매관리비 합계', sgaTotal, { is_subtotal: true }),
    line('operating_profit', '영업이익', operatingProfit, { is_subtotal: true }),
    line('non_op_in_header', '영업외수익', zero, { is_section_header: true }),
    ...nonOpInc.map(r => line(`noi_${r.code}`, r.name, r.values)),
    line('non_op_out_header', '영업외비용', zero, { is_section_header: true }),
    ...nonOpExp.map(r => line(`noe_${r.code}`, r.name, r.values)),
    line('pretax_profit', '법인세차감전순이익', pretaxProfit, { is_subtotal: true }),
    line('tax', '법인세', tax, { is_placeholder: true }),
    line('net_profit', '당기순이익', netProfit, { is_subtotal: true }),
  ]

  return { result: { months, items } }
}
