import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase-server'
import { syncCardExpenseJournal } from '@/lib/journal/card-posting'

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

  // 변경 전 상태(감사필드용)
  const { data: before } = await admin
    .from('card_expenses')
    .select('confirmed_account_id, classify_status, account_changed_count')
    .eq('id', id)
    .single()

  // 재분류 감사
  if ('confirmed_account_id' in updates
      && updates.confirmed_account_id !== before?.confirmed_account_id
      && before?.confirmed_account_id) {
    updates.account_changed_count = ((before.account_changed_count as number) ?? 0) + 1
    updates.prev_account_id = before.confirmed_account_id
  }
  // 확정 전이 시 확정자/시각
  if (updates.classify_status === 'confirmed' && before?.classify_status !== 'confirmed') {
    updates.confirmed_at = new Date().toISOString()
    try {
      const supa = await createClient()
      const { data: u } = await supa.auth.getUser()
      updates.confirmed_by = u.user?.id ?? null
    } catch { /* 세션 없으면 null */ }
  }

  const { error } = await admin.from('card_expenses').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 분개 동기화 (확정→전기 / 해제→취소 / 재분류→재전기)
  const jr = await syncCardExpenseJournal(admin, id)
  if ('error' in jr) return NextResponse.json({ error: `분개 전기 실패: ${jr.error}` }, { status: 500 })

  return NextResponse.json({ ok: true })
}
