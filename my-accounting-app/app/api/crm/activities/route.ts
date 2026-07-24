import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const TYPES = ['call', 'visit', 'kakao', 'gift', 'sample', 'order_followup', 'etc']

// POST /api/crm/activities — 관리 활동 등록
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const b = await req.json()
  if (!b.contact_id || !b.activity_date || !TYPES.includes(b.activity_type)) {
    return NextResponse.json({ error: '고객·일자·유형은 필수입니다.' }, { status: 400 })
  }
  const { data, error } = await admin
    .from('crm_activities')
    .insert({
      contact_id: b.contact_id,
      activity_date: b.activity_date,
      activity_type: b.activity_type,
      staff_name: b.staff_name || null,
      summary: b.summary || null,
      memo: b.memo || null,
      next_action_date: b.next_action_date || null,
      next_action_memo: b.next_action_memo || null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// DELETE /api/crm/activities?id= — 활동 삭제
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  const { error } = await admin.from('crm_activities').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
