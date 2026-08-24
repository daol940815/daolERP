import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDailyCashRows } from './cash-reports'

// ── 한도대출(마이너스 통장) 이자 — 통장 일별 잔액 기준 ──────────────
// 은행 방식 그대로: 이자 = Σ(일별 사용액 x 연이율 / 365)
// 사용액은 통장 원본에서 나온다(일별 잔액이 음수인 만큼이 사용액).
//   · buildDailyCashRows(..., bankAccountId)가 계좌별 일자별 overdraft_used를 준다.
//   · 현재 사용액을 곱하는 단순 추정과 달리, 기간 중 사용액 변동이 그대로 반영된다.

export interface LoanInterestInput {
  id: string
  bank_account_id: string | null
  interest_rate: number | null
}

export interface LoanInterestResult {
  loan_id: string
  by_month: Record<string, number>  // 'YYYY-MM' -> 이자
  total: number
  days: number
  last_used: number                 // 기간 마지막 날 사용액 (잔여일 추정용)
}

export async function buildCreditLineInterest(
  admin: SupabaseClient,
  loans: LoanInterestInput[],
  from: string,
  to: string,
): Promise<{ rows: LoanInterestResult[] } | { error: string }> {
  const targets = loans.filter(l => l.bank_account_id && l.interest_rate != null)
  if (!targets.length) return { rows: [] }

  // 같은 계좌를 여러 대출이 참조할 수 있으므로 계좌 단위로 한 번만 조회한다
  const accountIds = Array.from(new Set(targets.map(l => l.bank_account_id as string)))
  const fetched = await Promise.all(accountIds.map(async id => ({
    id, res: await buildDailyCashRows(admin, from, to, id),
  })))

  const daily = new Map<string, { date: string; used: number }[]>()
  for (const { id, res } of fetched) {
    if ('error' in res) return { error: res.error }
    daily.set(id, res.rows.map(r => ({ date: r.date, used: r.overdraft_used })))
  }

  const rows = targets.map(l => {
    const days = daily.get(l.bank_account_id as string) ?? []
    const perDay = (l.interest_rate as number) / 100 / 365
    const by_month: Record<string, number> = {}
    let total = 0
    for (const d of days) {
      const v = d.used * perDay
      const ym = d.date.slice(0, 7)
      by_month[ym] = (by_month[ym] ?? 0) + v
      total += v
    }
    for (const k of Object.keys(by_month)) by_month[k] = Math.round(by_month[k])
    return {
      loan_id: l.id,
      by_month,
      total: Math.round(total),
      days: days.length,
      last_used: days.length ? days[days.length - 1].used : 0,
    }
  })
  return { rows }
}
