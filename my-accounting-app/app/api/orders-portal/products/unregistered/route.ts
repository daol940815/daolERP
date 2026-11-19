import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// 품목 관리 '미등록 품목' 목록 (2026-11-19 사용자 승인, 시안 docs/mockups/미등록품목_등록_시안.html)
// 주문 · 상담 품목 중 품번 연결(product_id)이 없는 품명을 '품명 + 매입처'로 묶는다. 읽기만 — 주문 · 상담 행은 바꾸지 않는다.
//  - 주문: 직접 입력 주문(source = 'direct')만, 취소 주문 · 취소 품목 제외
//  - 상담: 삭제된 상담 제외, 배송비 의사 행(702 is_shipping) 제외
//  - 같은 품명 + 매입처(공백 무시)가 품목 관리에 이미 있으면 제외(등록하면 목록에서 빠짐)
// 최근 판매가 · 매입가 = 가장 최근에 쓴 행의 값.

type OrderRow = {
  item_name: string | null; purchase_vendor_name: string | null; sale_price: number; purchase_price: number; is_canceled: boolean | null
  order: { id: string; order_no: string; order_date: string; source: string | null; canceled_at: string | null } | null
}
type ConsultRow = {
  item_name: string | null; purchase_vendor_name: string | null; sale_price: number; purchase_price: number; is_shipping?: boolean | null
  consult: { id: string; consult_date: string; deleted_at: string | null } | null
}
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

const key = (name: string, vendor: string) => `${name.replace(/\s+/g, '').toLowerCase()}|${vendor.replace(/\s+/g, '').toLowerCase()}`

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const [orders, consults, products] = await Promise.all([
    fetchAllRows<OrderRow>((from, to) => admin.from('erp_order_items')
      .select('item_name, purchase_vendor_name, sale_price, purchase_price, is_canceled, order:erp_orders!inner(id, order_no, order_date, source, canceled_at)')
      .is('product_id', null).order('id').range(from, to) as unknown as Page<OrderRow>),
    fetchAllRows<ConsultRow>((from, to) => admin.from('erp_consultation_items')
      .select('item_name, purchase_vendor_name, sale_price, purchase_price, is_shipping, consult:erp_consultations!inner(id, consult_date, deleted_at)')
      .is('product_id', null).order('id').range(from, to) as unknown as Page<ConsultRow>),
    fetchAllRows<{ item_name: string; purchase_vendor_name: string | null }>((from, to) => admin.from('erp_products')
      .select('item_name, purchase_vendor_name').order('id').range(from, to) as unknown as Page<{ item_name: string; purchase_vendor_name: string | null }>),
  ])
  for (const r of [orders, consults, products]) if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  if ('error' in orders || 'error' in consults || 'error' in products) return NextResponse.json({ error: '조회 실패' }, { status: 500 })

  const registered = new Set(products.data.map(p => key(p.item_name ?? '', p.purchase_vendor_name ?? '')))
  type Use = { kind: 'order' | 'consult'; id: string; label: string; date: string }
  const groups = new Map<string, {
    item_name: string; purchase_vendor_name: string; last_sale: number; last_purchase: number; last_date: string
    orders: number; consults: number; uses: Use[]
  }>()
  const add = (name: string | null, vendor: string | null, sale: number, purchase: number, use: Use) => {
    const n = (name ?? '').trim()
    if (!n) return
    const v = (vendor ?? '').trim()
    const k = key(n, v)
    if (registered.has(k)) return
    const g = groups.get(k) ?? { item_name: n, purchase_vendor_name: v, last_sale: 0, last_purchase: 0, last_date: '', orders: 0, consults: 0, uses: [] }
    if (use.date >= g.last_date) { g.last_date = use.date; g.last_sale = Number(sale) || 0; g.last_purchase = Number(purchase) || 0 }
    if (!g.uses.some(u => u.kind === use.kind && u.id === use.id)) {   // 같은 주문 · 상담의 여러 행은 한 번만 셈
      if (use.kind === 'order') g.orders++; else g.consults++
      g.uses.push(use)
    }
    groups.set(k, g)
  }
  for (const r of orders.data) {
    const o = r.order
    if (!o || o.source !== 'direct' || o.canceled_at || r.is_canceled) continue
    add(r.item_name, r.purchase_vendor_name, r.sale_price, r.purchase_price, { kind: 'order', id: o.id, label: `주문 ${o.order_no}`, date: o.order_date })
  }
  for (const r of consults.data) {
    const c = r.consult
    if (!c || c.deleted_at || r.is_shipping) continue
    add(r.item_name, r.purchase_vendor_name, r.sale_price, r.purchase_price, { kind: 'consult', id: c.id, label: `상담 ${c.consult_date}`, date: c.consult_date })
  }

  const items = Array.from(groups.values())
    .map(g => ({ ...g, uses: g.uses.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20) }))
    .sort((a, b) => b.last_date.localeCompare(a.last_date))
  return NextResponse.json({ items })
}
