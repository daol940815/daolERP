import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecVat } from './payment-kind'

// 주문에 남긴 "계산서 발행" 결제 기록의 과세 구분 (1304) — 계산서 연결 창 · 계산서 확인 후보가 같은 구분 안에서만 찾을 때 쓴다.
//   (2026-11-18 사용자 승인 — 시안 docs/mockups/같은구분_안에서_찾기_시안.html)
//   'taxable' | 'exempt' = 구분을 적은 기록이 한 종류뿐 / 'mixed' = 과세 · 면세 기록이 둘 다 있음(걸러내지 않는다)
//   맵에 없음 = 계산서 발행 기록이 없거나 구분 미기재(걸러내지 않는다). 1304 미적용이면 빈 맵.
// 다른 lib 을 import 하지 않는다(순환 방지).
export type OrderVat = RecVat | 'mixed'

export async function loadRecordedInvoiceVat(admin: SupabaseClient, orderIds: string[]): Promise<Map<string, OrderVat>> {
  const out = new Map<string, OrderVat>()
  const ids = Array.from(new Set(orderIds.filter(Boolean)))
  const links: { order_id: string; record_id: string }[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from('order_payment_record_orders').select('order_id, record_id').in('order_id', ids.slice(i, i + 150))
    if (error) return out
    links.push(...((data ?? []) as typeof links))
  }
  const recIds = Array.from(new Set(links.map(l => l.record_id)))
  const vatOf = new Map<string, RecVat>()
  for (let i = 0; i < recIds.length; i += 150) {
    const { data, error } = await admin.from('order_payment_records').select('id, vat_kind').eq('method', 'invoice').not('vat_kind', 'is', null).in('id', recIds.slice(i, i + 150))
    if (error) return out
    for (const r of data ?? []) vatOf.set(r.id as string, r.vat_kind as RecVat)
  }
  for (const l of links) {
    const v = vatOf.get(l.record_id); if (!v) continue
    const cur = out.get(l.order_id)
    out.set(l.order_id, cur && cur !== v ? 'mixed' : v)
  }
  return out
}

// 주문의 기록 구분과 계산서 종류가 함께 갈 수 있는가 — 어느 한쪽이라도 모르면(또는 mixed) 막지 않는다
export const vatCompatible = (orderVat: OrderVat | null | undefined, taxType: string | null | undefined) =>
  !orderVat || orderVat === 'mixed' || !taxType || orderVat === taxType

// 주문내역 엑셀용 (2026-11-18 사용자 요청): 주문에 남긴 결제 기록의 카드 결제 방식 · 과세 구분을 주문 한 줄에 담는다.
//   기록이 여러 건이면 서로 다른 값만 ', '로 잇는다(예: '과세, 면세'). 미기재 · 계좌이체 · 기록 없음 = 빈 칸. 1304 미적용이면 빈 맵.
export async function loadOrderKindText(admin: SupabaseClient, orderIds: string[]): Promise<Map<string, { entry: string; vat: string }>> {
  const out = new Map<string, { entry: string; vat: string }>()
  const ids = Array.from(new Set(orderIds.filter(Boolean)))
  const links: { order_id: string; record_id: string }[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from('order_payment_record_orders').select('order_id, record_id').in('order_id', ids.slice(i, i + 150))
    if (error) return out
    links.push(...((data ?? []) as typeof links))
  }
  const recIds = Array.from(new Set(links.map(l => l.record_id)))
  const kindOf = new Map<string, { card_entry: string | null; vat_kind: string | null }>()
  for (let i = 0; i < recIds.length; i += 150) {
    const { data, error } = await admin.from('order_payment_records').select('id, card_entry, vat_kind').in('id', recIds.slice(i, i + 150))
    if (error) return out
    for (const r of data ?? []) kindOf.set(r.id as string, { card_entry: r.card_entry as string | null, vat_kind: r.vat_kind as string | null })
  }
  const ENTRY: Record<string, string> = { terminal: '단말기', manual: '수기' }
  const VAT: Record<string, string> = { taxable: '과세', exempt: '면세' }
  const sets = new Map<string, { entry: Set<string>; vat: Set<string> }>()
  for (const l of links) {
    const k = kindOf.get(l.record_id); if (!k) continue
    const s = sets.get(l.order_id) ?? { entry: new Set<string>(), vat: new Set<string>() }
    if (k.card_entry && ENTRY[k.card_entry]) s.entry.add(ENTRY[k.card_entry])
    if (k.vat_kind && VAT[k.vat_kind]) s.vat.add(VAT[k.vat_kind])
    sets.set(l.order_id, s)
  }
  const join = (s: Set<string>, order: string[]) => order.filter(x => s.has(x)).join(', ')
  for (const [id, s] of Array.from(sets)) out.set(id, { entry: join(s.entry, ['단말기', '수기']), vat: join(s.vat, ['과세', '면세']) })
  return out
}
