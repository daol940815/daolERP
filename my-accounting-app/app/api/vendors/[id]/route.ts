import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

const VENDOR_FIELDS = 'id, name, biz_number, type, contact_name, contact_phone, email, note, match_aliases, card_numbers, ledger_balance, ledger_balance_updated_at, is_active, created_at, updated_at'

// GET /api/vendors/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const { data, error } = await admin
    .from('vendors')
    .select(VENDOR_FIELDS)
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  return NextResponse.json({ data })
}

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
    match_aliases?: string[]; card_numbers?: string[]
    ledger_balance?: number | null
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
  if (body.match_aliases !== undefined) updates.match_aliases = body.match_aliases
  if (body.card_numbers  !== undefined) updates.card_numbers  = body.card_numbers
  // 거래처원장 잔액은 거래처가 통보할 때마다 사람이 수기로 갱신하는 값 — 입력 시점을 갱신일자로 기록
  if (body.ledger_balance !== undefined) {
    updates.ledger_balance             = body.ledger_balance
    updates.ledger_balance_updated_at  = body.ledger_balance == null ? null : new Date().toISOString().slice(0, 10)
  }

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
