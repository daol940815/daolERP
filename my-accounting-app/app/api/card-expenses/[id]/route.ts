import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// PATCH /api/card-expenses/[id]
// body:
//   { approve: true }                       → 제안(suggested) 계정을 확정으로 승인
//   { confirmed_account_id: uuid | null }   → 계정과목 직접 지정/해제
//   { classification?, memo? }              → 분류/메모 수정
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    approve?: boolean
    confirmed_account_id?: string | null
    classification?: string | null
    memo?: string | null
  }

  const updates: Record<string, unknown> = {}

  if (body.approve) {
    const { data: cur, error: ce } = await admin
      .from('card_expenses')
      .select('suggested_account_id')
      .eq('id', id)
      .single()
    if (ce) return NextResponse.json({ error: ce.message }, { status: 500 })
    if (!cur?.suggested_account_id) {
      return NextResponse.json({ error: '제안된 계정과목이 없어 승인할 수 없습니다.' }, { status: 400 })
    }
    updates.confirmed_account_id = cur.suggested_account_id
    updates.classify_status = 'confirmed'
  }

  if (body.confirmed_account_id !== undefined) {
    updates.confirmed_account_id = body.confirmed_account_id
    updates.classify_status = body.confirmed_account_id ? 'confirmed' : 'pending'
  }
  if (body.classification !== undefined) updates.classification = body.classification
  if (body.memo !== undefined) updates.memo = body.memo

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '수정할 내용이 없습니다.' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { error } = await admin.from('card_expenses').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
