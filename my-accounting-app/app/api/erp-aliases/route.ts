import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/erp-aliases?type=customer|purchase&unmatched=true
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const type      = searchParams.get('type')
  const unmatched = searchParams.get('unmatched')

  let query = admin
    .from('erp_vendor_aliases')
    .select('*, vendors(name)')
    .order('erp_name')
    .limit(2000)

  if (type === 'customer' || type === 'purchase') query = query.eq('alias_type', type)
  if (unmatched === 'true') query = query.is('vendor_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}

// PATCH /api/erp-aliases — body: { id, vendor_id?, payment_term? }
export async function PATCH(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({}))

  const id = body.id as string | undefined
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('vendor_id' in body)    patch.vendor_id = body.vendor_id
  if ('payment_term' in body) patch.payment_term = body.payment_term

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('erp_vendor_aliases')
    .update(patch)
    .eq('id', id)
    .select('*, vendors(name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
