import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/sales-cycle/pipeline
// 매출 사이클 현황판: 매출처별 "ERP 주문 → 계산서 발행 → 수금 배분 → 미수 잔액".
// 상태는 저장하지 않고 조회 시 계산한다 (매입 사이클과 동일 원칙).
export async function GET() {
  const admin = createAdminClient()

  const aliasResult = await fetchAllRows<{ id: string; vendor_id: string }>((f, t) =>
    admin.from('erp_vendor_aliases')
      .select('id, vendor_id')
      .eq('alias_type', 'customer')
      .not('vendor_id', 'is', null)
      .range(f, t))
  if ('error' in aliasResult) return NextResponse.json({ error: aliasResult.error }, { status: 500 })
  const aliasToVendor = new Map(aliasResult.data.map(a => [a.id, a.vendor_id]))

  const ordersResult = await fetchAllRows<{ id: string; order_date: string; customer_alias_id: string | null; total_amount: number | null }>((f, t) =>
    admin.from('erp_orders')
      .select('id, order_date, customer_alias_id, total_amount')
      .not('customer_alias_id', 'is', null)
      .range(f, t))
  if ('error' in ordersResult) return NextResponse.json({ error: ordersResult.error }, { status: 500 })
  const orders = ordersResult.data.filter(o => aliasToVendor.has(o.customer_alias_id as string))

  // 순매출 보정 (취소/VIP/선결제 품목 차감)
  // 주의: 주문 ID를 .in()으로 URL에 싣지 않는다 — ID 500개면 URL이 18KB를 넘어
  // 경로에 따라 연결이 끊기며 'fetch failed'가 난다. 해당 품목은 전체가 수천 행
  // 수준이라 짧은 URL로 전부 읽고 메모리에서 거르는 쪽이 안전하고 빠르다.
  const orderIdSet = new Set(orders.map(o => o.id))
  const excluded = new Map<string, number>()
  const flaggedResult = await fetchAllRows<{ order_id: string; line_total: number | null }>((f, t) =>
    admin.from('erp_order_items')
      .select('order_id, line_total')
      .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
      .range(f, t))
  if ('error' in flaggedResult) return NextResponse.json({ error: flaggedResult.error }, { status: 500 })
  for (const it of flaggedResult.data) {
    if (!orderIdSet.has(it.order_id)) continue
    excluded.set(it.order_id, (excluded.get(it.order_id) ?? 0) + (it.line_total ?? 0))
  }

  const matchesResult = await fetchAllRows<{ order_id: string; amount: number }>((f, t) =>
    admin.from('erp_payment_matches').select('order_id, amount').range(f, t))
  if ('error' in matchesResult) return NextResponse.json({ error: matchesResult.error }, { status: 500 })
  const allocByOrder = new Map<string, number>()
  for (const m of matchesResult.data) allocByOrder.set(m.order_id, (allocByOrder.get(m.order_id) ?? 0) + m.amount)

  // 매출 계산서 (거래처별 발행 현황)
  const invResult = await fetchAllRows<{ vendor_id: string | null; total_amount: number | null; payment_status: string }>((f, t) =>
    admin.from('tax_invoices')
      .select('vendor_id, total_amount, payment_status')
      .eq('direction', 'sales')
      .range(f, t))
  if ('error' in invResult) return NextResponse.json({ error: invResult.error }, { status: 500 })

  const vendorsResult = await fetchAllRows<{ id: string; name: string }>((f, t) =>
    admin.from('vendors').select('id, name').range(f, t))
  if ('error' in vendorsResult) return NextResponse.json({ error: vendorsResult.error }, { status: 500 })
  const vName = new Map(vendorsResult.data.map(v => [v.id, v.name]))

  interface Row {
    vendor_id: string
    vendor_name: string
    order_count: number
    order_net: number
    allocated: number
    remaining: number
    invoice_count: number
    invoice_total: number
    status: 'done' | 'partial' | 'none' | 'no_order'
    no_invoice: boolean
  }
  const rows = new Map<string, Row>()
  const row = (vid: string): Row => {
    let r = rows.get(vid)
    if (!r) {
      r = { vendor_id: vid, vendor_name: vName.get(vid) ?? '(삭제된 거래처)', order_count: 0, order_net: 0, allocated: 0, remaining: 0, invoice_count: 0, invoice_total: 0, status: 'none', no_invoice: false }
      rows.set(vid, r)
    }
    return r
  }

  for (const o of orders) {
    const vid = aliasToVendor.get(o.customer_alias_id as string)!
    const net = (o.total_amount ?? 0) - (excluded.get(o.id) ?? 0)
    const alloc = Math.min(allocByOrder.get(o.id) ?? 0, net)
    const r = row(vid)
    r.order_count++
    r.order_net += net
    r.allocated += alloc
  }
  for (const inv of invResult.data) {
    if (!inv.vendor_id) continue
    const r = row(inv.vendor_id)
    r.invoice_count++
    r.invoice_total += inv.total_amount ?? 0
  }

  const list = Array.from(rows.values()).map(r => {
    r.remaining = r.order_net - r.allocated
    r.status = r.order_count === 0 ? 'no_order'
      : r.remaining <= 0 ? 'done'
      : r.allocated <= 0 ? 'none'
      : 'partial'
    r.no_invoice = r.order_count > 0 && r.invoice_count === 0
    return r
  }).sort((a, b) => b.remaining - a.remaining)

  const totalNet = list.reduce((s, r) => s + r.order_net, 0)
  const totalAlloc = list.reduce((s, r) => s + r.allocated, 0)
  return NextResponse.json({
    rows: list,
    summary: {
      vendors: list.length,
      order_total: totalNet,
      allocated_total: totalAlloc,
      remaining_total: totalNet - totalAlloc,
      collect_ratio: totalNet > 0 ? totalAlloc / totalNet : 1,
      match_count: matchesResult.data.length,
    },
  })
}
