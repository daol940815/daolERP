import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCreditLineInterest } from '@/lib/loan-interest'

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
    return NextResponse.json({
      year, months, interest_expense: zero, interest_income: zero,
      credit_interest: zero, credit_ok: false, journal_ok: false,
    })
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

  // 한도대출 이자 — 통장 일별 잔액 기준으로 월별 산출 (사용액 변동이 그대로 반영됨)
  const { data: creditLoans } = await admin
    .from('loans')
    .select('id, bank_account_id, interest_rate, product_type, status')
    .eq('product_type', 'credit_line')
  const targets = (creditLoans ?? []).filter(l => l.status !== 'closed')
  const creditByMonth = months.map(() => 0)
  let creditOk = false
  if (targets.length) {
    const ci = await buildCreditLineInterest(
      admin,
      targets.map(l => ({ id: l.id as string, bank_account_id: l.bank_account_id as string | null,
                          interest_rate: l.interest_rate as number | null })),
      `${year}-01-01`, `${year}-12-31`,
    )
    if (!('error' in ci)) {
      creditOk = true
      for (const r of ci.rows) {
        months.forEach((mth, i) => { creditByMonth[i] += r.by_month[mth] ?? 0 })
      }
    }
  }

  return NextResponse.json({
    year, months,
    interest_expense: expense,
    interest_income: income,
    credit_interest: creditByMonth,
    credit_ok: creditOk,
    journal_ok: true,
  })
}
