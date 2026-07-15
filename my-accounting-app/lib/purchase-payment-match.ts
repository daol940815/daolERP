import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ── 매입 지급 후보 탐색 (매입 사이클 3단계 — 설계 v3 로드맵 4) ─────────────
// 한 거래처의 "미결제 매입 계산서"와 "미연결 통장 출금"을 놓고 연결 후보를 찾는다.
//   A. 1:1 정확 일치 (계산서 잔액 = 출금 잔액)
//   B. 합산: 계산서 1장 = 출금 여러 건의 합 (파인갤러리 유형 — 분할 지급)
//   C. 역합산: 출금 1건 = 계산서 여러 장의 합 (월말 몰아서 지급)
// 원칙: 여기서는 후보만 만든다 — 연결 확정은 사용자가 한다 (회계정책 §4).

export interface CandidateInvoice {
  id: string
  issue_date: string
  item_name: string | null
  total_amount: number
  remaining: number      // 총액 - 이미 연결된 결제
}
export interface CandidateTx {
  id: string
  tx_date: string
  tx_time?: string | null
  description: string | null
  amount_out: number
  remaining: number      // 출금액 - 이미 다른 계산서에 연결된 금액
}
export interface CandidateGroup {
  type: 'exact' | 'split_payment' | 'combined_invoices'
  label: string
  invoices: CandidateInvoice[]
  txs: CandidateTx[]
  amount: number
  // 확정 시 생성할 연결 목록 (invoice × tx × 금액)
  links: { invoiceId: string; transactionId: string; amount: number }[]
}

const MAX_COMBO = 8          // 합산 조합 최대 크기
const MAX_NODES = 30000      // 부분합 탐색 상한 (폭주 방지)
const DATE_WINDOW_DAYS = 120 // 계산서 발행일 기준 지급 탐색 범위 (전 30일 ~ 후 120일)

const dayDiff = (a: string, b: string) =>
  (new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime()) / 86_400_000

// 목표 금액과 정확히 일치하는 부분집합 탐색 (금액 내림차순 + 가지치기, 첫 해만)
function findSubset(items: { id: string; amount: number }[], target: number): string[] | null {
  const sorted = [...items].sort((a, b) => b.amount - a.amount)
  const suffix: number[] = new Array(sorted.length + 1).fill(0)
  for (let i = sorted.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + sorted[i].amount
  let nodes = 0
  const pick: string[] = []
  const dfs = (idx: number, remain: number, depth: number): boolean => {
    if (remain === 0) return depth >= 2            // 합산은 2건 이상일 때만 의미
    if (idx >= sorted.length || depth >= MAX_COMBO) return false
    if (remain < 0 || suffix[idx] < remain) return false
    if (++nodes > MAX_NODES) return false
    // 포함
    pick.push(sorted[idx].id)
    if (dfs(idx + 1, remain - sorted[idx].amount, depth + 1)) return true
    pick.pop()
    // 제외
    return dfs(idx + 1, remain, depth)
  }
  return dfs(0, target, 0) ? [...pick] : null
}

export async function buildPaymentCandidates(
  admin: SupabaseClient,
  vendorId: string,
): Promise<{ invoices: CandidateInvoice[]; txs: CandidateTx[]; groups: CandidateGroup[] } | { error: string }> {
  // ── 미결제 매입 계산서 (양수 총액만 — 음수 수정계산서는 자동 매칭 대상 아님) ──
  const invResult = await fetchAllRows<{ id: string; issue_date: string; item_name: string | null; total_amount: number }>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, item_name, total_amount')
      .eq('direction', 'purchase')
      .eq('vendor_id', vendorId)
      .gt('total_amount', 0)
      .range(f, t))
  if ('error' in invResult) return { error: invResult.error }

  // 계산서별 기연결 금액
  const invoiceIds = invResult.data.map(i => i.id)
  const paidByInvoice = new Map<string, number>()
  const usedByTx = new Map<string, number>()
  for (let i = 0; i < invoiceIds.length; i += 100) {
    const chunk = invoiceIds.slice(i, i + 100)
    const payResult = await fetchAllRows<{ tax_invoice_id: string; transaction_id: string; amount: number }>((f, t) =>
      admin.from('tax_invoice_payments')
        .select('tax_invoice_id, transaction_id, amount')
        .in('tax_invoice_id', chunk)
        .range(f, t))
    if ('error' in payResult) return { error: payResult.error }
    for (const p of payResult.data) {
      paidByInvoice.set(p.tax_invoice_id, (paidByInvoice.get(p.tax_invoice_id) ?? 0) + p.amount)
      usedByTx.set(p.transaction_id, (usedByTx.get(p.transaction_id) ?? 0) + p.amount)
    }
  }

  const invoices: CandidateInvoice[] = invResult.data
    .map(i => ({ ...i, remaining: i.total_amount - (paidByInvoice.get(i.id) ?? 0) }))
    .filter(i => i.remaining > 0)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date))

  // ── 이 거래처의 미연결 출금 (거래처 태깅 기준 — 별칭 학습이 태깅을 채워준다) ──
  const txResult = await fetchAllRows<{ id: string; tx_date: string; tx_time: string | null; description: string | null; amount_out: number; transfer_pair_id: string | null }>((f, t) =>
    admin.from('transactions')
      .select('id, tx_date, tx_time, description, amount_out, transfer_pair_id')
      .eq('vendor_id', vendorId)
      .gt('amount_out', 0)
      .is('transfer_pair_id', null)
      .range(f, t))
  if ('error' in txResult) return { error: txResult.error }

  // 이 거래처 외 계산서에 연결된 금액도 차감해야 하므로 tx 단위 사용액을 보정 조회
  const txIds = txResult.data.map(t => t.id)
  for (let i = 0; i < txIds.length; i += 100) {
    const chunk = txIds.slice(i, i + 100)
    const r = await fetchAllRows<{ transaction_id: string; amount: number }>((f, t) =>
      admin.from('tax_invoice_payments').select('transaction_id, amount').in('transaction_id', chunk).range(f, t))
    if ('error' in r) return { error: r.error }
    for (const p of r.data) {
      if (!usedByTx.has(p.transaction_id)) usedByTx.set(p.transaction_id, 0)
    }
    // usedByTx는 위 계산서 조회에서 이 거래처 연결분만 채워졌을 수 있어 전체 재계산
    const agg = new Map<string, number>()
    for (const p of r.data) agg.set(p.transaction_id, (agg.get(p.transaction_id) ?? 0) + p.amount)
    for (const [k, v] of Array.from(agg.entries())) usedByTx.set(k, v)
  }

  const txs: CandidateTx[] = txResult.data
    .map(t => ({ id: t.id, tx_date: t.tx_date, tx_time: t.tx_time, description: t.description, amount_out: t.amount_out, remaining: t.amount_out - (usedByTx.get(t.id) ?? 0) }))
    .filter(t => t.remaining > 0)
    .sort((a, b) => a.tx_date.localeCompare(b.tx_date))

  // ── 후보 그룹 탐색 ──
  const groups: CandidateGroup[] = []
  const usedInv = new Set<string>()
  const usedTx = new Set<string>()
  const txWindow = (inv: CandidateInvoice) => txs.filter(t =>
    !usedTx.has(t.id) &&
    dayDiff(t.tx_date, inv.issue_date) >= -30 &&
    dayDiff(t.tx_date, inv.issue_date) <= DATE_WINDOW_DAYS)

  // A. 1:1 정확 일치 (후보가 여럿이면 날짜가 가장 가까운 것)
  for (const inv of invoices) {
    const cands = txWindow(inv).filter(t => t.remaining === inv.remaining)
    if (!cands.length) continue
    const tx = cands.sort((a, b) => Math.abs(dayDiff(a.tx_date, inv.issue_date)) - Math.abs(dayDiff(b.tx_date, inv.issue_date)))[0]
    usedInv.add(inv.id); usedTx.add(tx.id)
    groups.push({
      type: 'exact', label: '1:1 정확 일치',
      invoices: [inv], txs: [tx], amount: inv.remaining,
      links: [{ invoiceId: inv.id, transactionId: tx.id, amount: inv.remaining }],
    })
  }

  // B. 계산서 1장 = 출금 여러 건 합 (분할 지급)
  for (const inv of invoices) {
    if (usedInv.has(inv.id)) continue
    const pool = txWindow(inv).map(t => ({ id: t.id, amount: t.remaining }))
    if (pool.length < 2) continue
    const picked = findSubset(pool, inv.remaining)
    if (!picked) continue
    const chosen = txs.filter(t => picked.includes(t.id))
    usedInv.add(inv.id); chosen.forEach(t => usedTx.add(t.id))
    groups.push({
      type: 'split_payment', label: `분할 지급 (출금 ${chosen.length}건 합산)`,
      invoices: [inv], txs: chosen, amount: inv.remaining,
      links: chosen.map(t => ({ invoiceId: inv.id, transactionId: t.id, amount: t.remaining })),
    })
  }

  // C. 출금 1건 = 계산서 여러 장 합 (몰아서 지급)
  for (const tx of txs) {
    if (usedTx.has(tx.id)) continue
    const pool = invoices
      .filter(i => !usedInv.has(i.id) && dayDiff(tx.tx_date, i.issue_date) >= -30 && dayDiff(tx.tx_date, i.issue_date) <= DATE_WINDOW_DAYS)
      .map(i => ({ id: i.id, amount: i.remaining }))
    if (pool.length < 2) continue
    const picked = findSubset(pool, tx.remaining)
    if (!picked) continue
    const chosen = invoices.filter(i => picked.includes(i.id))
    usedTx.add(tx.id); chosen.forEach(i => usedInv.add(i.id))
    groups.push({
      type: 'combined_invoices', label: `합산 지급 (계산서 ${chosen.length}장)`,
      invoices: chosen, txs: [tx], amount: tx.remaining,
      links: chosen.map(i => ({ invoiceId: i.id, transactionId: tx.id, amount: i.remaining })),
    })
  }

  return { invoices, txs, groups }
}
