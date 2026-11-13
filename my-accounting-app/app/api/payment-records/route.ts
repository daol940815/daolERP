import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { loadConfirmQueue } from '@/lib/payment-records'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 결제 확인 대기열 (1300) — GET /api/payment-records?state=pending|confirmed
// 확인 대기 기록마다 카드 매출 · 통장 입금 원본에서 찾은 후보를 붙여 준다. 확정은 사람이 누른다.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const state = new URL(req.url).searchParams.get('state') === 'confirmed' ? 'confirmed' : 'pending'
  const r = await loadConfirmQueue(createAdminClient(), { state, meId: me.employeeId })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ...r, can_edit: can(me, 'collections', 'edit') })
}
