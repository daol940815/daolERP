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
