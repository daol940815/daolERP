import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CARD_SALE_FIELDS = `
  id, tx_date, tx_time, transaction_type, approval_number, card_number, acquirer,
  amount, supply_amount, tax_amount,
  processing_status, deposit_expected_date, cancelled_at, settlement_status,
  vendor_id, note, created_at, updated_at
`

// GET /api/card-sales?vendorId=...&type=approval|cancel&from=&to=&unmatched=true&limit=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const vendorId  = searchParams.get('vendorId')
  const type      = searchParams.get('type')
  const from      = searchParams.get('from')
  const to        = searchParams.get('to')
  const unmatched = searchParams.get('unmatched') === 'true'

  // 전체 조회(range) — PostgREST max-rows(1000) 절단 방지
  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('card_sales')
      .select(CARD_SALE_FIELDS)
      .order('tx_date', { ascending: false })
      .order('tx_time', { ascending: false })
    if (vendorId)  query = query.eq('vendor_id', vendorId)
    if (type)      query = query.eq('transaction_type', type)
    if (from)      query = query.gte('tx_date', from)
    if (to)        query = query.lte('tx_date', to)
    if (unmatched) query = query.is('vendor_id', null)
    return query.range(f, t)
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.data })
}

// DELETE /api/card-sales — body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const { ids } = await req.json() as { ids: string[] }

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: '삭제할 항목을 선택하세요.' }, { status: 400 })
  }

  const { error } = await admin.from('card_sales').delete().in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, deleted: ids.length })
}
