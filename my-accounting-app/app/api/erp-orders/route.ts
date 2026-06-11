import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/erp-orders?from=&to=&status=&view=&q=&page=&limit=
// view: all(기본) | vip | prepayment — vip/선결제 별도 보기
// 페이지네이션 + 필터 전체 범위 요약(주문수/순매출/미수금) 반환
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from   = searchParams.get('from')
  const to     = searchParams.get('to')
  const status = searchParams.get('status')
  const view   = searchParams.get('view') ?? 'all'
  const q      = searchParams.get('q')?.trim()
  const page   = Math.max(parseInt(searchParams.get('page') ?? '1') || 1, 1)
  const limit  = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '100') || 100, 10), 500)

  // VIP/선결제 보기: 해당 품목이 있는 주문 id 목록
  let viewIds: string[] | null = null
  if (view === 'vip' || view === 'prepayment') {
    const flagCol = view === 'vip' ? 'is_vip' : 'is_prepayment'
    const { data: flagged, error: fe } = await admin
      .from('erp_order_items')
      .select('order_id')
      .eq(flagCol, true)
      .limit(10000)
    if (fe) return NextResponse.json({ error: fe.message }, { status: 500 })
    viewIds = Array.from(new Set((flagged ?? []).map(r => r.order_id as string)))
    if (!viewIds.length) {
      return NextResponse.json({ data: [], items: [], total: 0, page, limit, summary: { net_sales: 0, outstanding: 0 } })
    }
  }

  // 필터 전체 범위: 요약 계산용 경량 조회
  let sq = admin
    .from('erp_orders')
    .select('id, total_amount, outstanding_amount, collect_status')
    .limit(50000)
  if (from)                       sq = sq.gte('order_date', from)
  if (to)                         sq = sq.lte('order_date', to)
  if (status && status !== 'all') sq = sq.eq('collect_status', status)
  if (q) sq = sq.or(`order_no.ilike.%${q}%,bank_name.ilike.%${q}%,branch_name.ilike.%${q}%`)
  if (viewIds) sq = sq.in('id', viewIds)

  const { data: allOrders, error: se } = await sq
  if (se) return NextResponse.json({ error: se.message }, { status: 500 })

  const allIds = (allOrders ?? []).map(o => o.id as string)
  const total  = allIds.length

  // 제외 품목(취소/VIP/선결제) 합계 → 순매출 = 총금액 합 − 제외 합
  let excludedSum = 0
  for (let i = 0; i < allIds.length; i += 500) {
    const { data: flagged, error: ie } = await admin
      .from('erp_order_items')
      .select('line_total')
      .in('order_id', allIds.slice(i, i + 500))
      .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 })
    for (const it of flagged ?? []) excludedSum += (it.line_total as number) || 0
  }
  const netSales    = (allOrders ?? []).reduce((s, o) => s + ((o.total_amount as number) || 0), 0) - excludedSum
  const outstanding = (allOrders ?? [])
    .filter(o => o.collect_status !== 'collected')
    .reduce((s, o) => s + ((o.outstanding_amount as number) || 0), 0)

  // 현재 페이지 주문 조회
  const offset = (page - 1) * limit
  let pq = admin
    .from('erp_orders')
    .select('*')
    .order('order_date', { ascending: false })
    .order('order_no')
    .range(offset, offset + limit - 1)
  if (from)                       pq = pq.gte('order_date', from)
  if (to)                         pq = pq.lte('order_date', to)
  if (status && status !== 'all') pq = pq.eq('collect_status', status)
  if (q) pq = pq.or(`order_no.ilike.%${q}%,bank_name.ilike.%${q}%,branch_name.ilike.%${q}%`)
  if (viewIds) pq = pq.in('id', viewIds)

  const { data: orders, error } = await pq
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 조회된 주문들의 품목 일괄 로드
  const orderIds = (orders ?? []).map(o => o.id as string)
  let items: unknown[] = []
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data: chunk, error: ie } = await admin
      .from('erp_order_items')
      .select('*')
      .in('order_id', orderIds.slice(i, i + 200))
      .order('line_no')
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 })
    items = items.concat(chunk ?? [])
  }

  return NextResponse.json({
    data: orders ?? [],
    items,
    total,
    page,
    limit,
    summary: { net_sales: netSales, outstanding },
  })
}

// DELETE /api/erp-orders — body: { ids: string[] } (주문 단위 삭제, 품목 CASCADE)
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const { ids } = await req.json().catch(() => ({ ids: null })) as { ids: string[] | null }

  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: '삭제할 주문을 선택하세요.' }, { status: 400 })
  }

  const { error } = await admin.from('erp_orders').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, deleted: ids.length })
}
