import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const CARD_SALE_FIELDS = `
  id, tx_date, tx_time, transaction_type, approval_number, card_number, acquirer,
  amount, supply_amount, tax_amount,
  processing_status, deposit_expected_date, cancelled_at, settlement_status,
  vendor_id, note, created_at, updated_at
`

// PATCH /api/card-sales/:id — 거래처 매칭 수정 / 메모
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json() as { vendor_id?: string | null; note?: string | null }

  const updates: Record<string, unknown> = {}
  if ('vendor_id' in body) updates.vendor_id = body.vendor_id
  if ('note'      in body) updates.note      = body.note?.trim() || null

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: '업데이트할 항목이 없습니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('card_sales')
    .update(updates)
    .eq('id', id)
    .select(CARD_SALE_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}

// DELETE /api/card-sales/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const { error } = await admin.from('card_sales').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
