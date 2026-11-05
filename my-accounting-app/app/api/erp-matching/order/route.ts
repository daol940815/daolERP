import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { allocateToOrder, loadCollectCandidates, loadOrderCollectSummary, type OrderAllocation } from '@/lib/erp-order-collect'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 주문 쪽 수금 매칭 (2026-11-04)
//   GET  /api/erp-matching/order?orderId=&scope=vendor|all&from=&to=&amount=&card4=&q=
//        → { order, candidates }
//   POST /api/erp-matching/order { order_id, allocations: [{source_type, source_id, amount}], register_card?, memo? }
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const orderId = sp.get('orderId')
  if (!orderId) return NextResponse.json({ error: 'orderId가 필요합니다.' }, { status: 400 })
  const order = await loadOrderCollectSummary(admin, orderId)
  if ('error' in order) return NextResponse.json({ error: order.error }, { status: 404 })
  const cands = await loadCollectCandidates(admin, order, {
    scope: sp.get('scope') === 'all' ? 'all' : 'vendor',
    from: sp.get('from'), to: sp.get('to'),
    amount: sp.get('amount') ? Number(String(sp.get('amount')).replace(/,/g, '')) : null,
    card4: sp.get('card4'), q: sp.get('q'),
    onlyRemaining: sp.get('all') !== '1',
  })
  if ('error' in cands) return NextResponse.json({ error: cands.error }, { status: 500 })
  return NextResponse.json({ order, candidates: cands.data })
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { order_id?: string; allocations?: OrderAllocation[]; register_card?: boolean; memo?: string }
  if (!body.order_id) return NextResponse.json({ error: 'order_id가 필요합니다.' }, { status: 400 })
  const allocations = (body.allocations ?? []).filter(a => (a.source_type === 'bank' || a.source_type === 'card') && a.source_id)
  const r = await allocateToOrder(admin, body.order_id, allocations, { registerCard: body.register_card !== false, memo: body.memo ?? null })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...r })
}
