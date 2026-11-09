// 개별 배송 명단 서버 공용 (707) — route 파일은 핸들러만 export 해야 하므로 여기에 둔다
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RosterItemCandidate, RosterRowInput } from './delivery-roster'
import { isRosterMissing, normName } from './delivery-roster'

// 연결 후보 = 상담 품목 또는 주문 품목 (본 상품만 — 부자재·배송비 행 제외)
export async function rosterCandidates(admin: SupabaseClient, key: { consultationId?: string | null; orderId?: string | null }): Promise<RosterItemCandidate[]> {
  if (key.consultationId) {
    const { data } = await admin.from('erp_consultation_items')
      .select('product_id, item_code, item_name, order_kind, quantity, parent_line_no, is_shipping')
      .eq('consultation_id', key.consultationId).order('line_no')
    return ((data ?? []) as Record<string, unknown>[])
      .filter(r => !r.parent_line_no && !r.is_shipping && r.item_name)
      .map(r => ({ product_id: (r.product_id as string) ?? null, item_code: (r.item_code as string) ?? null,
        item_name: String(r.item_name), order_kind: (r.order_kind as string) ?? null, quantity: Number(r.quantity ?? 0) }))
  }
  if (key.orderId) {
    const { data } = await admin.from('erp_order_items')
      .select('product_id, item_code, item_name, order_kind, quantity, parent_line_no, is_canceled')
      .eq('order_id', key.orderId).order('line_no')
    return ((data ?? []) as Record<string, unknown>[])
      .filter(r => !r.parent_line_no && !r.is_canceled && r.item_name)
      .map(r => ({ product_id: (r.product_id as string) ?? null, item_code: (r.item_code as string) ?? null,
        item_name: String(r.item_name), order_kind: (r.order_kind as string) ?? null, quantity: Number(r.quantity ?? 0) }))
  }
  return []
}

// 명단 머리 찾기 — 상담 기준, 또는 주문 기준(상담 전환분은 상담 명단을, 직접 업로드분은 주문 명단을)
export async function findRoster(admin: SupabaseClient, key: { consultationId?: string | null; orderId?: string | null }) {
  if (key.consultationId) {
    const { data, error } = await admin.from('erp_delivery_rosters').select('*').eq('consultation_id', key.consultationId).maybeSingle()
    return { roster: data, error }
  }
  if (key.orderId) {
    const direct = await admin.from('erp_delivery_rosters').select('*').eq('order_id', key.orderId).maybeSingle()
    if (direct.error) return { roster: null, error: direct.error }
    if (direct.data) return { roster: direct.data, error: null }
    // 상담 전환 주문: 주문의 consultation_id로 상담 명단
    const { data: ord } = await admin.from('erp_orders').select('consultation_id').eq('id', key.orderId).maybeSingle()
    if (ord?.consultation_id) {
      const { data, error } = await admin.from('erp_delivery_rosters').select('*').eq('consultation_id', ord.consultation_id).maybeSingle()
      return { roster: data, error }
    }
  }
  return { roster: null, error: null }
}

// 주문에 연결된 명단 행 (발주서용). 707 미적용이면 빈 배열.
export async function rosterRowsForOrder(admin: SupabaseClient, orderId: string): Promise<RosterRowInput[]> {
  const { data, error } = await admin.from('erp_delivery_roster_rows').select('*')
    .eq('order_id', orderId).order('seq').limit(5000)
  if (error) {
    if (isRosterMissing(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as unknown as RosterRowInput[]
}

// 상담 → 주문 전환: 상담 명단 행을 새 주문에 연결 (품목이 그 주문에 포함된 행 + 미연결 행)
// 분할 전환(품목 일부만 주문)은 품목이 일치하는 행만 붙는다. 이미 다른 주문에 연결된 행은 건드리지 않는다.
export async function attachRosterToOrder(admin: SupabaseClient, consultationId: string, orderId: string,
  orderItems: { product_id?: string | null; item_name?: string | null }[]) {
  const { data: roster, error } = await admin.from('erp_delivery_rosters').select('id').eq('consultation_id', consultationId).maybeSingle()
  if (error || !roster) return { attached: 0 }
  const { data: rows } = await admin.from('erp_delivery_roster_rows').select('id, product_id, item_name, order_id')
    .eq('roster_id', roster.id).is('order_id', null).limit(5000)
  if (!rows?.length) return { attached: 0 }
  const pids = new Set(orderItems.map(i => i.product_id).filter(Boolean) as string[])
  const names = new Set(orderItems.map(i => normName(i.item_name)).filter(Boolean))
  const ids = (rows as Record<string, unknown>[])
    .filter(r => !r.item_name || (r.product_id && pids.has(String(r.product_id))) || names.has(normName(r.item_name)))
    .map(r => String(r.id))
  for (let i = 0; i < ids.length; i += 150) {
    await admin.from('erp_delivery_roster_rows').update({ order_id: orderId }).in('id', ids.slice(i, i + 150))
  }
  return { attached: ids.length }
}
