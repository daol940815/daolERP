import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/loans/report?year=YYYY
// 연간 리포트의 '실적' 데이터 — 확정된 이자비용(5301) 분개를 월별로 집계한다.
// 계획(계약 조건 기준)은 대출 마스터로 화면에서 계산하므로 여기서는 실적만 낸다.
// 대출 원리금 분리 전에는 이자비용 분개가 없어 0으로 나온다(정상 — 화면에 안내 표시).
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const now = new Date()
  const year = Math.min(Math.max(parseInt(searchParams.get('year') ?? '') || now.getFullYear(), 2000), 2100)

  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const zero = months.map(() => 0)

  const { data: accs, error: ae } = await admin
    .from('accounts').select('id, code').in('code', ['5301', '4002'])
  if (ae) return NextResponse.json({ error: ae.message }, { status: 500 })
  const interestExpenseId = accs?.find(a => a.code === '5301')?.id ?? null
  const interestIncomeId  = accs?.find(a => a.code === '4002')?.id ?? null

  const { data: rows, error } = await admin
    .rpc('monthly_pl_journal_summary', { p_from: `${year}-01-01`, p_to: `${year}-12-31` })
  if (error) {
    // 058 미적용 등 — 실적 없이 계획만 보이게 한다
    return NextResponse.json({ year, months, interest_expense: zero, interest_income: zero, journal_ok: false })
  }

  const idx = new Map(months.map((m, i) => [m, i]))
  const expense = months.map(() => 0)
  const income = months.map(() => 0)
  for (const r of rows ?? []) {
    const i = idx.get(r.month as string)
    if (i === undefined) continue
    const debit = (r.debit as number) || 0
    const credit = (r.credit as number) || 0
    if (r.account_id === interestExpenseId) expense[i] += debit - credit   // 비용: 차변 - 대변
    if (r.account_id === interestIncomeId)  income[i]  += credit - debit   // 수익: 대변 - 차변
  }

  return NextResponse.json({ year, months, interest_expense: expense, interest_income: income, journal_ok: true })
}
