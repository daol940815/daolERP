import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cash-receipts
// Query params: direction, from, to, type, unmatched
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction = searchParams.get('direction')
  const from      = searchParams.get('from')
  const to        = searchParams.get('to')
  const type      = searchParams.get('type')
  const unmatched = searchParams.get('unmatched')

  // 전체 조회(range) — PostgREST max-rows(1000) 절단 방지
  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('cash_receipts')
      .select('*')
      .order('tx_date', { ascending: false })
    if (direction)              query = query.eq('direction', direction)
    if (from)                   query = query.gte('tx_date', from)
    if (to)                     query = query.lte('tx_date', to)
    if (type && type !== 'all') query = query.eq('transaction_type', type)
    if (unmatched === 'true')   query = query.is('vendor_id', null)
    return query.range(f, t)
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.data })
}

// DELETE /api/cash-receipts — 선택 건 일괄 삭제
// Body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids : []

  if (!ids.length) return NextResponse.json({ error: 'ids 필드가 필요합니다.' }, { status: 400 })

  const { data, error } = await admin
    .from('cash_receipts')
    .delete()
    .in('id', ids)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: data?.length ?? 0 })
}
