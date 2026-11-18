import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const lastDay = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`
}

// GET /api/sales-cycle/pipeline?from=YYYY-MM&to=YYYY-MM
// 매출 사이클 현황판: 매출처별 "ERP 주문 → 계산서 발행 → 수금 배분 → 미수 잔액".
// 상태는 저장하지 않고 조회 시 계산한다 (매입 사이클과 동일 원칙).
// 기간은 주문일·계산서 발행일 기준 — 기간 밖 주문의 미수는 집계에 안 잡히므로
// 화면 기본값은 전체 기간이고, 사용자가 좁혀서 볼 때만 범위가 줄어든다.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const from = sp.get('from') // YYYY-MM
  const to = sp.get('to')
  const fromDate = from ? `${from}-01` : null
  const toDate = to ? lastDay(to) : null

  const aliasResult = await fetchAllRows<{ id: string; vendor_id: string }>((f, t) =>
    admin.from('erp_vendor_aliases')
      .select('id, vendor_id')
      .eq('alias_type', 'customer')
      .not('vendor_id', 'is', null)
      .range(f, t))
  if ('error' in aliasResult) return NextResponse.json({ error: aliasResult.error }, { status: 500 })
  const aliasToVendor = new Map(aliasResult.data.map(a => [a.id, a.vendor_id]))

  const ordersResult = await fetchAllRows<{ id: string; order_date: string; customer_alias_id: string | null; total_amount: number | null }>((f, t) => {
    let q = admin.from('erp_orders')
      .select('id, order_date, customer_alias_id, total_amount')
      .not('customer_alias_id', 'is', null)
    if (fromDate) q = q.gte('order_date', fromDate)
    if (toDate) q = q.lte('order_date', toDate)
    return q.range(f, t)
  })
  if ('error' in ordersResult) return NextResponse.json({ error: ordersResult.error }, { status: 500 })
  const orders = ordersResult.data.filter(o => aliasToVendor.has(o.customer_alias_id as string))

  // 순매출 = 취소/VIP/선결제가 아닌 품목 합 (lib/receivable.ts 표준, 2026-11-18)
  //   '총액 − 제외 품목'은 수정한 직접 입력 주문에서 취소 행을 두 번 빼므로 쓰지 않는다.
  // 주의: 주문 ID를 한 번에 .in()으로 싣지 않는다 — ID 500개면 URL이 18KB를 넘어
  // 'fetch failed'가 난다. 150개씩 나눠 조회한다(약 5.6KB).
  const orderIds = orders.map(o => o.id)
  const netByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 150) {
    const ch = orderIds.slice(i, i + 150)
    const itemsResult = await fetchAllRows<{ order_id: string; line_total: number | null; is_canceled: boolean | null; is_vip: boolean | null; is_prepayment: boolean | null }>((f, t) =>
      admin.from('erp_order_items')
        .select('order_id, line_total, is_canceled, is_vip, is_prepayment')
        .in('order_id', ch)
        .range(f, t))
    if ('error' in itemsResult) return NextResponse.json({ error: itemsResult.error }, { status: 500 })
    for (const it of itemsResult.data) {
      if (it.is_canceled || it.is_vip || it.is_prepayment) continue
      netByOrder.set(it.order_id, (netByOrder.get(it.order_id) ?? 0) + (it.line_total ?? 0))
    }
  }

  const matchesResult = await fetchAllRows<{ order_id: string; amount: number }>((f, t) =>
    admin.from('erp_payment_matches').select('order_id, amount').range(f, t))
  if ('error' in matchesResult) return NextResponse.json({ error: matchesResult.error }, { status: 500 })
  const allocByOrder = new Map<string, number>()
  for (const m of matchesResult.data) allocByOrder.set(m.order_id, (allocByOrder.get(m.order_id) ?? 0) + m.amount)

  // 주문 ↔ 계산서 연결 배분 (067) — 테이블 미적용 환경은 0으로 폴백
  const invAllocByOrder = new Map<string, number>()
  let invoiceLinkReady = true
  {
    const r = await fetchAllRows<{ order_id: string; amount: number }>((f, t) =>
      admin.from('erp_order_invoices').select('order_id, amount').range(f, t))
    if ('error' in r) invoiceLinkReady = false
    else for (const m of r.data) invAllocByOrder.set(m.order_id, (invAllocByOrder.get(m.order_id) ?? 0) + m.amount)
  }

  // 매출 계산서 (거래처별 발행 현황)
  const invResult = await fetchAllRows<{ vendor_id: string | null; total_amount: number | null; payment_status: string }>((f, t) => {
    let q = admin.from('tax_invoices')
      .select('vendor_id, total_amount, payment_status')
      .eq('direction', 'sales')
    if (fromDate) q = q.gte('issue_date', fromDate)
    if (toDate) q = q.lte('issue_date', toDate)
    return q.range(f, t)
  })
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
    invoice_linked: number
    invoice_count: number
    invoice_total: number
    status: 'done' | 'partial' | 'none' | 'no_order'
    no_invoice: boolean
  }
  const rows = new Map<string, Row>()
  const row = (vid: string): Row => {
    let r = rows.get(vid)
    if (!r) {
      r = { vendor_id: vid, vendor_name: vName.get(vid) ?? '(삭제된 거래처)', order_count: 0, order_net: 0, allocated: 0, remaining: 0, invoice_linked: 0, invoice_count: 0, invoice_total: 0, status: 'none', no_invoice: false }
      rows.set(vid, r)
    }
    return r
  }

  for (const o of orders) {
    const vid = aliasToVendor.get(o.customer_alias_id as string)!
    const net = netByOrder.get(o.id) ?? 0
    const alloc = Math.min(allocByOrder.get(o.id) ?? 0, net)
    const r = row(vid)
    r.order_count++
    r.order_net += net
    r.allocated += alloc
    r.invoice_linked += Math.min(invAllocByOrder.get(o.id) ?? 0, net)
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
  const totalInvLinked = list.reduce((s, r) => s + r.invoice_linked, 0)
  return NextResponse.json({
    rows: list,
    summary: {
      vendors: list.length,
      order_total: totalNet,
      allocated_total: totalAlloc,
      remaining_total: totalNet - totalAlloc,
      collect_ratio: totalNet > 0 ? totalAlloc / totalNet : 1,
      match_count: matchesResult.data.length,
      invoice_linked_total: totalInvLinked,
      invoice_link_ratio: totalNet > 0 ? totalInvLinked / totalNet : 1,
      invoice_link_ready: invoiceLinkReady,
    },
  })
}
