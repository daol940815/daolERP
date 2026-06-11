import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/erp-orders?from=&to=&status=&view=&q=&limit=
// view: all(기본) | vip | prepayment — vip/선결제 별도 보기
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from   = searchParams.get('from')
  const to     = searchParams.get('to')
  const status = searchParams.get('status')
  const view   = searchParams.get('view') ?? 'all'
  const q      = searchParams.get('q')?.trim()
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '300'), 1000)

  let query = admin
    .from('erp_orders')
    .select('*')
    .order('order_date', { ascending: false })
    .order('order_no')
    .limit(limit)

  if (from)                     query = query.gte('order_date', from)
  if (to)                       query = query.lte('order_date', to)
  if (status && status !== 'all') query = query.eq('collect_status', status)
  if (q) query = query.or(`order_no.ilike.%${q}%,bank_name.ilike.%${q}%,branch_name.ilike.%${q}%`)

  // VIP/선결제 보기: 해당 품목이 있는 주문만
  if (view === 'vip' || view === 'prepayment') {
    const flagCol = view === 'vip' ? 'is_vip' : 'is_prepayment'
    const { data: flagged, error: fe } = await admin
      .from('erp_order_items')
      .select('order_id')
      .eq(flagCol, true)
      .limit(10000)
    if (fe) return NextResponse.json({ error: fe.message }, { status: 500 })
    const ids = Array.from(new Set((flagged ?? []).map(r => r.order_id as string)))
    if (!ids.length) return NextResponse.json({ data: [], items: [] })
    query = query.in('id', ids)
  }

  const { data: orders, error } = await query
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

  return NextResponse.json({ data: orders ?? [], items })
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
