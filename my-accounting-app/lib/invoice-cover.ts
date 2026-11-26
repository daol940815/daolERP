import type { SupabaseClient } from '@supabase/supabase-js'
import { netRecordLinks } from './payment-cancel-meta'

// ── 계산서 말고 다른 증빙으로 받은 금액 (2026-11-26 사용자 결정 — docs/payment-track.md) ──
// 주문을 카드 + 계산서로 나눠 받으면(예: D261112-015 카드 1,071,400 + 계산서 4,290,000) 계산서로 덮을 금액은
//   청구 금액 − 카드 결제 − 현금영수증 입금 − 이미 연결한 계산서
// 카드 결제 = max(주문에 매칭된 카드 매출 순액, 카드 결제 기록 합(취소 줄 뺌)) — 매칭 전 기록도 빼고, 같은 결제를 두 번 빼지 않는다.
// 현금영수증 입금 = 주문에 붙은 통장 입금 중 현금영수증이 연결된 입금의 매칭 금액.
// 쓰는 곳: 계산서 연결 창 후보(lib/order-invoice-match.ts) · 저장 재검사(/api/sales-cycle/invoice-candidates) · 계산서 확인 탭 필요 금액(lib/payment-guide.ts).

const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

export async function loadNonInvoiceCover(admin: SupabaseClient, orderIds: string[]): Promise<Map<string, { card: number; receipt: number; total: number }>> {
  const out = new Map<string, { card: number; receipt: number; total: number }>()
  const ids = Array.from(new Set(orderIds.filter(Boolean)))
  if (!ids.length) return out
  const cardMatch = new Map<string, number>()
  const bankByOrder: { order_id: string; source_id: string; amount: number }[] = []
  const recLinks: { record_id: string; order_id: string; amount: number }[] = []
  for (const ch of chunk(ids, 150)) {
    const [m, rl] = await Promise.all([
      admin.from('erp_payment_matches').select('order_id, source_type, source_id, amount').in('order_id', ch).in('source_type', ['card', 'bank']),
      admin.from('order_payment_record_orders').select('record_id, order_id, amount').in('order_id', ch),
    ])
    for (const r of m.data ?? []) {
      const amt = Number(r.amount ?? 0)
      if (r.source_type === 'card') cardMatch.set(r.order_id as string, (cardMatch.get(r.order_id as string) ?? 0) + amt)
      else bankByOrder.push({ order_id: r.order_id as string, source_id: r.source_id as string, amount: amt })
    }
    if (!rl.error) recLinks.push(...((rl.data ?? []) as typeof recLinks).map(l => ({ ...l, amount: Number(l.amount) })))
  }
  // 카드 결제 기록 (취소 줄은 원 기록에서 뺀다)
  const cardRec = new Map<string, number>()
  if (recLinks.length) {
    const cardIds = new Set<string>()
    for (const ch of chunk(Array.from(new Set(recLinks.map(l => l.record_id))), 150)) {
      const { data } = await admin.from('order_payment_records').select('id').eq('method', 'card').in('id', ch)
      for (const r of data ?? []) cardIds.add(r.id as string)
    }
    const net = await netRecordLinks(admin, recLinks.filter(l => cardIds.has(l.record_id)))
    for (const l of net) cardRec.set(l.order_id, (cardRec.get(l.order_id) ?? 0) + l.amount)
  }
  // 현금영수증이 붙은 통장 입금
  const withReceipt = new Set<string>()
  for (const ch of chunk(Array.from(new Set(bankByOrder.map(b => b.source_id))), 150)) {
    const { data, error } = await admin.from('cash_receipt_payments').select('transaction_id').in('transaction_id', ch)
    if (error) break   // 425 미적용 — 현금영수증은 보지 않는다
    for (const r of data ?? []) withReceipt.add(r.transaction_id as string)
  }
  const receipt = new Map<string, number>()
  for (const b of bankByOrder) if (withReceipt.has(b.source_id)) receipt.set(b.order_id, (receipt.get(b.order_id) ?? 0) + b.amount)

  for (const id of ids) {
    const card = Math.max(0, cardMatch.get(id) ?? 0, cardRec.get(id) ?? 0)
    const rc = Math.max(0, receipt.get(id) ?? 0)
    if (card || rc) out.set(id, { card, receipt: rc, total: card + rc })
  }
  return out
}
