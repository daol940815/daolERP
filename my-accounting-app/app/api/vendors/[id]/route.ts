import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

const VENDOR_FIELDS = 'id, name, biz_number, type, contact_name, contact_phone, email, note, is_active, created_at, updated_at'

// PATCH /api/vendors/:id — 거래처 정보 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json() as {
    name?: string; biz_number?: string | null; type?: string; is_active?: boolean
    contact_name?: string | null; contact_phone?: string | null; email?: string | null; note?: string | null
  }

  const updates: Record<string, unknown> = {}
  if (body.name          !== undefined) updates.name          = body.name.trim()
  if (body.biz_number    !== undefined) updates.biz_number    = body.biz_number?.trim()    || null
  if (body.type          !== undefined) updates.type          = body.type
  if (body.is_active     !== undefined) updates.is_active     = body.is_active
  if (body.contact_name  !== undefined) updates.contact_name  = body.contact_name?.trim()  || null
  if (body.contact_phone !== undefined) updates.contact_phone = body.contact_phone?.trim() || null
  if (body.email         !== undefined) updates.email         = body.email?.trim()         || null
  if (body.note          !== undefined) updates.note          = body.note?.trim()          || null

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: '업데이트할 항목이 없습니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('vendors')
    .update(updates)
    .eq('id', id)
    .select(VENDOR_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}

// DELETE /api/vendors/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  // 거래처 삭제 시 연결된 transactions.vendor_id / tax_invoices.vendor_id 는 ON DELETE SET NULL 로 자동 처리
  const { error } = await admin.from('vendors').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
