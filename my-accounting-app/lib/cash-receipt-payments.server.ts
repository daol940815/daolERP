import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { normalizeName } from '@/lib/name-similarity'

// 현금영수증(매출 발행) ↔ 통장 입금 연결 (425, 2026-11-13 승인 시안)
// 계산서 결제연결(lib/tax-invoice-payments.server.ts)과 같은 모양 — 1건에 여러 입금(분할), 한 입금에 여러 영수증(합산).
// 분개에는 영향이 없다(현금영수증은 분개하지 않는다). 연결 정보만 더한다.

type Admin = SupabaseClient
type Result = { ok: true } | { ok: false; error: string }

export const AUTO_MATCH_WINDOW_DAYS = 7

export interface ReceiptPaymentRow {
  id: string
  amount: number
  matched_by: 'auto' | 'manual'
  created_at: string
  transaction: { id: string; tx_date: string; description: string | null; counterparty_name: string | null; amount_in: number; account_alias: string | null } | null
}

const daysBetween = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)

// 연결 합으로 payment_status 재계산
export async function recalcReceiptStatus(admin: Admin, receiptId: string) {
  const { data: r } = await admin.from('cash_receipts').select('amount').eq('id', receiptId).single()
  if (!r) return
  const { data: pays } = await admin.from('cash_receipt_payments').select('amount').eq('cash_receipt_id', receiptId)
  const linked = (pays ?? []).reduce((s, p) => s + (p.amount as number), 0)
  const total = Math.abs((r.amount as number) ?? 0)
  const status = linked <= 0 ? 'unmatched' : linked >= total ? 'matched' : 'partial'
  await admin.from('cash_receipts').update({ payment_status: status }).eq('id', receiptId)
}

// 입금 1건이 이미 쓰인 금액 — 계산서 결제연결 + 현금영수증 연결 합 (남은 입금액 계산용)
export async function usedAmountByTx(admin: Admin, txIds: string[]): Promise<Map<string, number>> {
  const used = new Map<string, number>()
  for (let i = 0; i < txIds.length; i += 100) {
    const slice = txIds.slice(i, i + 100)
    const [a, b] = await Promise.all([
      admin.from('tax_invoice_payments').select('transaction_id, amount').in('transaction_id', slice),
      admin.from('cash_receipt_payments').select('transaction_id, amount').in('transaction_id', slice),
    ])
    for (const p of [...(a.data ?? []), ...(b.data ?? [])]) used.set(p.transaction_id, (used.get(p.transaction_id) ?? 0) + Math.abs(p.amount as number))
  }
  return used
}

export async function addReceiptPayment(
  admin: Admin, receiptId: string, transactionId: string, amount: number, matchedBy: 'auto' | 'manual' = 'manual',
): Promise<Result> {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: '연결할 금액은 0보다 커야 합니다.' }
  const { data: r } = await admin.from('cash_receipts').select('direction, transaction_type, amount').eq('id', receiptId).single()
  if (!r) return { ok: false, error: '현금영수증을 찾을 수 없습니다.' }
  if (r.direction !== 'sales' || r.transaction_type !== 'approval') return { ok: false, error: '매출 발행 · 승인 건만 입금을 연결할 수 있습니다.' }
  const { data: pays } = await admin.from('cash_receipt_payments').select('amount, transaction_id').eq('cash_receipt_id', receiptId)
  if ((pays ?? []).some(p => p.transaction_id === transactionId)) return { ok: false, error: '이미 연결된 입금입니다.' }
  const linked = (pays ?? []).reduce((s, p) => s + (p.amount as number), 0)
  const remain = Math.abs(r.amount as number) - linked
  if (amount > remain) return { ok: false, error: `영수증의 남은 금액(${remain.toLocaleString('ko-KR')}원)을 넘을 수 없습니다.` }

  const { data: tx } = await admin.from('transactions').select('amount_in, transfer_pair_id').eq('id', transactionId).single()
  if (!tx) return { ok: false, error: '통장 거래를 찾을 수 없습니다.' }
  if (tx.transfer_pair_id) return { ok: false, error: '계좌 간 이체는 연결할 수 없습니다.' }
  const inflow = (tx.amount_in as number) ?? 0
  if (inflow <= 0) return { ok: false, error: '입금 거래만 연결할 수 있습니다.' }
  const used = await usedAmountByTx(admin, [transactionId])
  const txRemain = inflow - (used.get(transactionId) ?? 0)
  if (amount > txRemain) return { ok: false, error: `입금의 남은 금액(${txRemain.toLocaleString('ko-KR')}원)을 넘을 수 없습니다. 계산서나 다른 영수증에 이미 연결돼 있습니다.` }

  const { error } = await admin.from('cash_receipt_payments').insert({ cash_receipt_id: receiptId, transaction_id: transactionId, amount, matched_by: matchedBy })
  if (error) return { ok: false, error: error.message }
  await recalcReceiptStatus(admin, receiptId)
  await suggestSalesForLinkedDeposit(admin, transactionId)
  return { ok: true }
}

// 현금영수증에 연결된 입금은 상품매출(4001) 추천 — 계산서 연결 입금 = 매출채권 추천과 대칭. 추천이 비어 있는 미확정 거래만.
let salesAccountId: string | null | undefined
async function suggestSalesForLinkedDeposit(admin: Admin, transactionId: string) {
  if (salesAccountId === undefined) {
    const { data } = await admin.from('accounts').select('id, side_on_in').eq('code', '4001').maybeSingle()
    salesAccountId = (data?.id as string | undefined) ?? null
  }
  if (!salesAccountId) return
  await admin.from('transactions')
    .update({ suggested_account_id: salesAccountId, suggested_side: 'credit', ai_confidence: 0.85, ai_reason: '현금영수증 연결 — 계산서 없는 매출 입금' })
    .eq('id', transactionId).eq('status', 'pending').is('suggested_account_id', null).is('confirmed_account_id', null)
}

export async function removeReceiptPayment(admin: Admin, receiptId: string, paymentId: string): Promise<Result> {
  const { error } = await admin.from('cash_receipt_payments').delete().eq('id', paymentId).eq('cash_receipt_id', receiptId)
  if (error) return { ok: false, error: error.message }
  await recalcReceiptStatus(admin, receiptId)
  return { ok: true }
}

export async function listReceiptPayments(admin: Admin, receiptId: string): Promise<ReceiptPaymentRow[]> {
  const { data } = await admin
    .from('cash_receipt_payments')
    .select('id, amount, matched_by, created_at, transaction:transactions(id, tx_date, description, counterparty_name, amount_in, account_alias)')
    .eq('cash_receipt_id', receiptId)
    .order('created_at', { ascending: false })
  return ((data ?? []) as unknown as ReceiptPaymentRow[])
}

export interface ReceiptCandidate {
  id: string; tx_date: string; description: string | null; counterparty_name: string | null; account_alias: string | null
  amount_in: number; remain: number        // 입금액 · 계산서·영수증 연결을 뺀 남은 금액
  lag: number                              // 입금일 − 발행일 (일)
  reason: string                           // 근거 설명
  score: number
}

// 후보 입금: 남은 금액이 영수증 잔액 이상(또는 금액 일치), 발행일 ±N일(기본 7). 직접 찾기(from·to·q)는 기간·검색어로.
export async function loadReceiptCandidates(
  admin: Admin, receiptId: string, opt: { from?: string | null; to?: string | null; q?: string | null } = {},
): Promise<{ receipt: { id: string; tx_date: string; amount: number; remain: number; counterparty_name: string | null }; candidates: ReceiptCandidate[] } | { error: string }> {
  const { data: r } = await admin.from('cash_receipts').select('id, tx_date, amount, counterparty_name, direction, transaction_type').eq('id', receiptId).single()
  if (!r) return { error: '현금영수증을 찾을 수 없습니다.' }
  const { data: pays } = await admin.from('cash_receipt_payments').select('amount').eq('cash_receipt_id', receiptId)
  const linked = (pays ?? []).reduce((s, p) => s + (p.amount as number), 0)
  const total = Math.abs((r.amount as number) ?? 0)
  const remain = total - linked
  const manual = !!(opt.from || opt.to || opt.q)
  const from = opt.from ?? new Date(new Date(r.tx_date).getTime() - AUTO_MATCH_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  const to   = opt.to   ?? new Date(new Date(r.tx_date).getTime() + AUTO_MATCH_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)

  type Tx = { id: string; tx_date: string; description: string | null; counterparty_name: string | null; account_alias: string | null; amount_in: number | null }
  const txR = await fetchAllRows<Tx>((f, t) => {
    let qb = admin.from('transactions')
      .select('id, tx_date, description, counterparty_name, account_alias, amount_in')
      .gt('amount_in', 0).is('transfer_pair_id', null)
      .gte('tx_date', from).lte('tx_date', to)
      .order('tx_date', { ascending: false })
    if (!manual) qb = qb.gte('amount_in', Math.max(1, remain))
    return qb.range(f, t)
  })
  if ('error' in txR) return { error: txR.error }
  let rows = txR.data
  const q = (opt.q ?? '').trim().toLowerCase()
  if (q) {
    const qn = /^[\d,]+원?$/.test(q) ? Number(q.replace(/[^0-9]/g, '')) : null
    rows = rows.filter(t => (t.description ?? '').toLowerCase().includes(q) || (t.counterparty_name ?? '').toLowerCase().includes(q) || (qn != null && t.amount_in === qn))
  }
  const used = await usedAmountByTx(admin, rows.map(t => t.id))
  const nameNorm = normalizeName(r.counterparty_name ?? '')
  const candidates: ReceiptCandidate[] = rows.map(t => {
    const inflow = t.amount_in ?? 0
    const rem = inflow - (used.get(t.id) ?? 0)
    const lag = daysBetween(t.tx_date, r.tx_date)
    const hay = normalizeName(`${t.description ?? ''} ${t.counterparty_name ?? ''}`)
    const nameHit = !!nameNorm && nameNorm.length >= 2 && hay.includes(nameNorm)
    let score = 0
    const why: string[] = []
    if (rem === remain) { score += 50; why.push('금액 일치') } else if (rem > remain) { score += 10; why.push('금액 ≥') } else { why.push('남은 금액 부족') }
    if (lag === 0) { score += 30; why.push('같은 날') } else { score += Math.max(0, 20 - Math.abs(lag)); why.push(lag > 0 ? `${lag}일 뒤` : `${-lag}일 전`) }
    if (nameHit) { score += 40; why.push('이름 일치') }
    if (rem < inflow) why.push(`이미 ${(inflow - rem).toLocaleString('ko-KR')} 연결됨`)
    return { id: t.id, tx_date: t.tx_date, description: t.description, counterparty_name: t.counterparty_name, account_alias: t.account_alias,
      amount_in: inflow, remain: rem, lag, reason: why.join(' · '), score }
  }).filter(c => manual || c.remain > 0)
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.lag) - Math.abs(b.lag))
  return { receipt: { id: r.id, tx_date: r.tx_date, amount: total, remain, counterparty_name: r.counterparty_name }, candidates: candidates.slice(0, 100) }
}

// 자동 매칭 — 금액 같음(입금의 남은 금액 = 영수증 잔액 = 전액) · ±7일 · 후보가 딱 1건일 때만 연결
export async function autoMatchReceipts(admin: Admin, ids: string[]): Promise<{ matched: number; ambiguous: number; none: number; skipped: number }> {
  let matched = 0, ambiguous = 0, none = 0, skipped = 0
  for (const id of ids) {
    const res = await loadReceiptCandidates(admin, id)
    if ('error' in res) { skipped++; continue }
    if (res.receipt.remain <= 0) { skipped++; continue }
    const exact = res.candidates.filter(c => c.remain === c.amount_in && c.amount_in === res.receipt.remain && Math.abs(c.lag) <= AUTO_MATCH_WINDOW_DAYS)
    if (exact.length === 1) {
      const r = await addReceiptPayment(admin, id, exact[0].id, res.receipt.remain, 'auto')
      if (r.ok) matched++; else skipped++
    } else if (exact.length > 1) ambiguous++
    else none++
  }
  return { matched, ambiguous, none, skipped }
}
