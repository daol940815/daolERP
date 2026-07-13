import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

const ACCOUNT_FIELDS = 'id, name, code, type, keywords, is_active, side_on_in, side_on_out'

// PATCH /api/accounts/:id — 키워드, 이름, 활성 여부, 차변/대변 규칙 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json() as {
    keywords?:    string[]
    name?:        string
    is_active?:   boolean
    side_on_in?:  'debit' | 'credit'
    side_on_out?: 'debit' | 'credit'
  }

  const updates: Record<string, unknown> = {}
  if (body.keywords    !== undefined) updates.keywords    = body.keywords
  if (body.name        !== undefined) updates.name        = body.name.trim()
  if (body.is_active   !== undefined) updates.is_active   = body.is_active
  if (body.side_on_in  !== undefined) updates.side_on_in  = body.side_on_in
  if (body.side_on_out !== undefined) updates.side_on_out = body.side_on_out

  const { data, error } = await admin
    .from('accounts')
    .update(updates)
    .eq('id', id)
    .select(ACCOUNT_FIELDS)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// DELETE /api/accounts/:id — 계정과목 삭제
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const { error } = await admin.from('accounts').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
