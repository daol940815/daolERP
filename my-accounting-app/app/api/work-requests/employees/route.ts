import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { HELP_QUESTION_RECIPIENT_LOGIN } from '@/lib/help-registry'

export const dynamic = 'force-dynamic'

// 담당자 선택용 직원 목록 — 로그인 계정이 있는 재직 직원(요청을 볼 수 있는 사람)만. /api/employees(인사 권한)와 분리.
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('employees')
    .select('id, name, team, position, employment_type, login_id')
    .eq('is_active', true).not('login_id', 'is', null)
    .order('team', { ascending: true, nullsFirst: false }).order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // 도움말 "질문하기"의 기본 담당자 (help-registry 의 로그인 id로 찾음, 2026-11-03)
  const recipient = (data ?? []).find(e => e.login_id === HELP_QUESTION_RECIPIENT_LOGIN)?.id ?? null
  const rows = (data ?? []).map(e => ({ id: e.id, name: e.name, team: e.team, position: e.position, employment_type: e.employment_type }))
  return NextResponse.json({ data: rows, me: me.employeeId, question_recipient: recipient })
}
