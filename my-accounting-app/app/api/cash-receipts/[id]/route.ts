import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// PATCH /api/cash-receipts/[id]
// Body: { vendor_id?, note? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({}))

  const allowed = ['vendor_id', 'note']
  const patch: Record<string, unknown> = {}
  for (const k of allowed) {
    if (k in body) patch[k] = body[k]
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('cash_receipts')
    .update(patch)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
