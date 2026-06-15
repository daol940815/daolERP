import type { SupabaseClient } from '@supabase/supabase-js'

// ── 계좌 통합현황 / 자금일보 ────────────────────────────────────────
// transactions.balance(은행 명세서 잔액)을 기준으로 계좌별·일별 잔액을 계산한다.
// 계좌에 입력된 거래가 없는 구간은 직전 known balance를 그대로 유지(carry-forward)한다.
//
// 마이너스통장(account_type = 'overdraft') 처리 원칙:
// - 원본 balance 값은 변환하지 않고 그대로 보존한다 (음수 그대로).
// - 표시/집계 단계에서만 보유현금·사용액·미사용한도·순현금·가용자금을 구분 계산한다.

export interface CashPositionRow {
  bank_account_id: string
  bank_name: string
  account_number: string | null
  alias: string | null
  account_type: 'normal' | 'overdraft'
  overdraft_limit: number | null  // 한도 (음수, 예: -200000000)
  balance: number       // 최신 잔액 (원본 그대로, 마이너스통장은 음수 가능)
  balance_date: string | null
  period_in: number     // 기간 내 입금 합계
  period_out: number    // 기간 내 출금 합계
  overdraft_used: number      // 마이너스통장 현재 사용액 (0 이상, 일반계좌는 0)
  overdraft_available: number // 마이너스통장 미사용 한도 (0 이상, 일반계좌는 0)
}

// 자금 요약 (5개 목적별 지표)
export interface FundSummary {
  held_cash: number           // 보유현금 = Σ(일반계좌 잔액)
  overdraft_used: number      // 마이너스통장 사용액 = Σmax(-balance, 0)
  overdraft_available: number // 마이너스통장 미사용한도 = Σmax(한도abs - 사용액, 0)
  net_cash: number            // 순현금/순차입 포지션 = Σ(일반계좌 잔액) + Σ(마이너스통장 잔액)
  available_funds: number     // 가용자금 = 보유현금 + 마이너스통장 미사용한도
}

export interface DailyCashRow {
  date: string
  opening_balance: number   // 전일 순현금(=net_cash, 하위호환)
  deposit: number
  withdrawal: number
  closing_balance: number   // 당일 순현금(=net_cash, 하위호환)
  held_cash: number          // 당일 보유현금 (일반계좌 잔액 합계)
  overdraft_used: number     // 당일 마이너스통장 사용액
  net_cash: number           // 당일 순현금/순차입 포지션 (=closing_balance)
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

// ── 계좌 통합현황: 계좌별 최신잔액 + 기간 내 입출금 합계 + 자금 요약 ──────────
export async function buildCashPositionRows(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<{ rows: CashPositionRow[]; total: number; summary: FundSummary } | { error: string }> {
  const { data: accounts, error: ae } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number, alias, account_type, overdraft_limit, is_active')
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

    const balance = latest?.balance ?? 0
    const accountType = (a.account_type as 'normal' | 'overdraft' | null) ?? 'normal'
    const overdraftLimit = (a.overdraft_limit as number | null) ?? null
    const overdraftUsed = accountType === 'overdraft' ? Math.max(-balance, 0) : 0
    const overdraftAvailable = accountType === 'overdraft' && overdraftLimit != null
      ? Math.max(Math.abs(overdraftLimit) - overdraftUsed, 0)
      : 0

    return {
      bank_account_id: a.id as string,
      bank_name: a.bank_name as string,
      account_number: a.account_number as string | null,
      alias: a.alias as string | null,
      account_type: accountType,
      overdraft_limit: overdraftLimit,
      balance,
      balance_date: latest?.date ?? null,
      period_in: periodIn,
      period_out: periodOut,
      overdraft_used: overdraftUsed,
      overdraft_available: overdraftAvailable,
    }
  })

  const heldCash = rows
    .filter(r => r.account_type === 'normal')
    .reduce((s, r) => s + r.balance, 0)
  const overdraftUsedTotal      = rows.reduce((s, r) => s + r.overdraft_used, 0)
  const overdraftAvailableTotal = rows.reduce((s, r) => s + r.overdraft_available, 0)
  const netCash = rows.reduce((s, r) => s + r.balance, 0)
  const availableFunds = heldCash + overdraftAvailableTotal

  const summary: FundSummary = {
    held_cash: heldCash,
    overdraft_used: overdraftUsedTotal,
    overdraft_available: overdraftAvailableTotal,
    net_cash: netCash,
    available_funds: availableFunds,
  }

  return { rows, total: netCash, summary }
}

// ── 자금일보: 기간 내 일별 전일잔액/입금/출금/당일 보유현금·마이너스통장사용액·순현금 ──
export async function buildDailyCashRows(
  admin: SupabaseClient,
  from: string,
  to: string,
  bankAccountId: string | null,
): Promise<{ rows: DailyCashRow[] } | { error: string }> {
  let aq = admin
    .from('bank_accounts')
    .select('id, account_type')
    .eq('is_active', true)
  if (bankAccountId) aq = aq.eq('id', bankAccountId)
  const { data: accounts, error: ae } = await aq
  if (ae) return { error: ae.message }

  const accountIds = (accounts ?? []).map(a => a.id as string)
  const isOverdraft = new Map<string, boolean>()
  for (const a of (accounts ?? [])) {
    isOverdraft.set(a.id as string, a.account_type === 'overdraft')
  }

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
    let heldCash = 0, overdraftUsed = 0
    for (const [id, state] of Array.from(states.entries())) {
      const openingBal = balanceAsOf(state.balanceEntries, prev)
      const closingBal = balanceAsOf(state.balanceEntries, cursor)
      opening += openingBal
      closing += closingBal
      deposit   += state.inByDate.get(cursor) ?? 0
      withdrawal += state.outByDate.get(cursor) ?? 0

      if (isOverdraft.get(id)) {
        overdraftUsed += Math.max(-closingBal, 0)
      } else {
        heldCash += closingBal
      }
    }
    rows.push({
      date: cursor,
      opening_balance: opening,
      deposit,
      withdrawal,
      closing_balance: closing,
      held_cash: heldCash,
      overdraft_used: overdraftUsed,
      net_cash: closing,
    })
    cursor = (() => {
      const d = new Date(`${cursor}T00:00:00`)
      d.setDate(d.getDate() + 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
  }

  return { rows }
}
