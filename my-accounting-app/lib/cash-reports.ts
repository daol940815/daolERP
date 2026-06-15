import type { SupabaseClient } from '@supabase/supabase-js'

// ── 계좌 통합현황 / 자금일보 ────────────────────────────────────────
// transactions.balance(은행 명세서 잔액)을 기준으로 계좌별·일별 잔액을 계산한다.
// 계좌에 입력된 거래가 없는 구간은 직전 known balance를 그대로 유지(carry-forward)한다.

export interface CashPositionRow {
  bank_account_id: string
  bank_name: string
  account_number: string | null
  alias: string | null
  balance: number       // 최신 잔액
  balance_date: string | null
  period_in: number     // 기간 내 입금 합계
  period_out: number    // 기간 내 출금 합계
}

export interface DailyCashRow {
  date: string
  opening_balance: number
  deposit: number
  withdrawal: number
  closing_balance: number
}

interface AccountState {
  inByDate: Map<string, number>
  outByDate: Map<string, number>
  // 잔액이 기록된 날짜만 오름차순 정렬 (balance 컬럼이 있는 거래의 tx_date)
  balanceEntries: { date: string; balance: number }[]
}

// 특정 날짜 기준 직전(이하) 가장 최근의 잔액을 반환 (없으면 0)
function balanceAsOf(entries: { date: string; balance: number }[], date: string): number {
  let result = 0
  for (const e of entries) {
    if (e.date > date) break
    result = e.balance
  }
  return result
}

// 계좌별 거래 내역을 로드해 일별 입출금/잔액 상태로 가공
async function loadAccountStates(
  admin: SupabaseClient,
  accountIds: string[],
  to: string,
): Promise<Map<string, AccountState>> {
  const states = new Map<string, AccountState>()
  for (const id of accountIds) {
    states.set(id, { inByDate: new Map(), outByDate: new Map(), balanceEntries: [] })
  }
  if (!accountIds.length) return states

  for (let i = 0; i < accountIds.length; i += 50) {
    const { data, error } = await admin
      .from('transactions')
      .select('bank_account_id, tx_date, amount_in, amount_out, balance')
      .in('bank_account_id', accountIds.slice(i, i + 50))
      .lte('tx_date', to)
      .order('tx_date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(200000)
    if (error) throw new Error(error.message)

    for (const t of data ?? []) {
      const accId = t.bank_account_id as string
      const state = states.get(accId)
      if (!state) continue
      const date = t.tx_date as string
      const amtIn = (t.amount_in as number) || 0
      const amtOut = (t.amount_out as number) || 0
      if (amtIn)  state.inByDate.set(date, (state.inByDate.get(date) ?? 0) + amtIn)
      if (amtOut) state.outByDate.set(date, (state.outByDate.get(date) ?? 0) + amtOut)
      if (t.balance !== null && t.balance !== undefined) {
        state.balanceEntries.push({ date, balance: t.balance as number })
      }
    }
  }
  return states
}

// ── 계좌 통합현황: 계좌별 최신잔액 + 기간 내 입출금 합계 + 총잔액 ──────────
export async function buildCashPositionRows(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<{ rows: CashPositionRow[]; total: number } | { error: string }> {
  const { data: accounts, error: ae } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number, alias, is_active')
    .eq('is_active', true)
    .order('bank_name')
  if (ae) return { error: ae.message }

  const accountIds = (accounts ?? []).map(a => a.id as string)
  const today = new Date().toISOString().slice(0, 10)
  let states: Map<string, AccountState>
  try {
    states = await loadAccountStates(admin, accountIds, to ?? today)
  } catch (e) {
    return { error: e instanceof Error ? e.message : '거래 내역 조회 실패' }
  }

  const rows: CashPositionRow[] = (accounts ?? []).map(a => {
    const state = states.get(a.id as string)!
    const latest = state.balanceEntries[state.balanceEntries.length - 1]
    let periodIn = 0
    let periodOut = 0
    for (const [date, amt] of Array.from(state.inByDate))  { if ((!from || date >= from) && (!to || date <= to)) periodIn += amt }
    for (const [date, amt] of Array.from(state.outByDate)) { if ((!from || date >= from) && (!to || date <= to)) periodOut += amt }
    return {
      bank_account_id: a.id as string,
      bank_name: a.bank_name as string,
      account_number: a.account_number as string | null,
      alias: a.alias as string | null,
      balance: latest?.balance ?? 0,
      balance_date: latest?.date ?? null,
      period_in: periodIn,
      period_out: periodOut,
    }
  })

  const total = rows.reduce((s, r) => s + r.balance, 0)
  return { rows, total }
}

// ── 자금일보: 기간 내 일별 전일잔액/입금/출금/당일잔액 (전 계좌 합산 또는 단일 계좌) ──
export async function buildDailyCashRows(
  admin: SupabaseClient,
  from: string,
  to: string,
  bankAccountId: string | null,
): Promise<{ rows: DailyCashRow[] } | { error: string }> {
  let aq = admin
    .from('bank_accounts')
    .select('id')
    .eq('is_active', true)
  if (bankAccountId) aq = aq.eq('id', bankAccountId)
  const { data: accounts, error: ae } = await aq
  if (ae) return { error: ae.message }

  const accountIds = (accounts ?? []).map(a => a.id as string)
  let states: Map<string, AccountState>
  try {
    states = await loadAccountStates(admin, accountIds, to)
  } catch (e) {
    return { error: e instanceof Error ? e.message : '거래 내역 조회 실패' }
  }

  const prevDay = (date: string) => {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const rows: DailyCashRow[] = []
  let cursor = from
  // 무한루프 방지용 안전장치 (최대 5년)
  for (let i = 0; i < 365 * 5 && cursor <= to; i++) {
    const prev = prevDay(cursor)
    let opening = 0, closing = 0, deposit = 0, withdrawal = 0
    for (const state of Array.from(states.values())) {
      opening   += balanceAsOf(state.balanceEntries, prev)
      closing   += balanceAsOf(state.balanceEntries, cursor)
      deposit   += state.inByDate.get(cursor) ?? 0
      withdrawal += state.outByDate.get(cursor) ?? 0
    }
    rows.push({ date: cursor, opening_balance: opening, deposit, withdrawal, closing_balance: closing })
    cursor = (() => {
      const d = new Date(`${cursor}T00:00:00`)
      d.setDate(d.getDate() + 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
  }

  return { rows }
}
