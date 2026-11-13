import type { SupabaseClient } from '@supabase/supabase-js'
import { methodTagOf, payStageOf, type PayState } from './pay-state'

const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

// ── 주문별 결제 상태 (목록 · 엑셀 · 상세 공용, lib/pay-state.ts 규칙) ─────────────────
// recv: 표준 미수 맵(loadReceivableMap). 1300 미적용이면 기록 0으로 계산된다(매칭만으로 판정).
export async function loadPayStateMap(
  admin: SupabaseClient,
  orders: { id: string; canceled: boolean }[],
  recv: Map<string, { outstanding: number; net_sales: number }> | null,
): Promise<Map<string, PayState>> {
  const out = new Map<string, PayState>()
  const ids = orders.filter(o => !o.canceled).map(o => o.id)
  const pending = new Map<string, number>()
  const methods = new Map<string, Set<string>>()
  const addMethod = (orderId: string, m: string) => { const s = methods.get(orderId) ?? new Set<string>(); s.add(m); methods.set(orderId, s) }

  const chunks = chunk(ids, 150)
  const [linkRes, matchRes] = await Promise.all([
    Promise.all(chunks.map(ch => admin.from('order_payment_record_orders').select('order_id, amount, record_id').in('order_id', ch))),
    Promise.all(chunks.map(ch => admin.from('erp_payment_matches').select('order_id, source_type, record_id').in('order_id', ch))),
  ])
  const links = linkRes.flatMap(r => (r.error ? [] : (r.data ?? []))) as { order_id: string; amount: number; record_id: string }[]
  const recIds = Array.from(new Set(links.map(l => l.record_id)))
  const recInfo = new Map<string, { method: string; confirmed: boolean }>()
  const recRes = await Promise.all(chunk(recIds, 150).map(ch => admin.from('order_payment_records').select('id, method, confirmed_at').in('id', ch)))
  for (const r of recRes) for (const x of r.data ?? []) recInfo.set(x.id as string, { method: x.method as string, confirmed: !!x.confirmed_at })
  for (const l of links) {
    const info = recInfo.get(l.record_id)
    if (!info) continue
    addMethod(l.order_id, info.method)
    if (!info.confirmed) pending.set(l.order_id, (pending.get(l.order_id) ?? 0) + Number(l.amount ?? 0))
  }
  // 기록 없이 붙인 매칭의 수단은 원본에서: 통장 = 이체, 카드 매출 = 카드, 선결제 사용 = 선결제
  const SRC: Record<string, string> = { bank: 'transfer', cash: 'transfer', card: 'card', prepay: 'prepay' }
  for (const r of matchRes) {
    for (const m of (r.error ? [] : (r.data ?? []))) {
      if (m.record_id) continue
      const tag = SRC[m.source_type as string]
      if (tag) addMethod(m.order_id as string, tag)
    }
  }

  for (const o of orders) {
    const rv = recv?.get(o.id)
    const st = payStageOf({ canceled: o.canceled, net: rv?.net_sales ?? 0, outstanding: rv?.outstanding ?? 0, pending: pending.get(o.id) ?? 0 })
    out.set(o.id, { ...st, method: methodTagOf(methods.get(o.id) ?? []) })
  }
  return out
}
