import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { loadConfirmQueue } from '@/lib/payment-records'
import { loadCancelQueue } from '@/lib/payment-cancel'
import { loadStaffScope } from '@/lib/payment-overview'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 결제 확인 대기열 (1300) — GET /api/payment-records?state=pending|confirmed
// 확인 대기 기록마다 카드 매출 · 통장 입금 원본에서 찾은 후보를 붙여 준다. 확정은 사람이 누른다.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const state = new URL(req.url).searchParams.get('state') === 'confirmed' ? 'confirmed' : 'pending'
  const admin = createAdminClient()
  const r = await loadConfirmQueue(admin, { state, meId: me.employeeId })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  // 취소 대기열 (1305) — 1차에서 남긴 취소 줄 가운데 아직 원본과 매칭하지 않은 것
  const cancels = state === 'pending' ? await loadCancelQueue(admin) : []
  return NextResponse.json({ ...r, cancels, scope: await loadStaffScope(admin, me), can_edit: can(me, 'collections', 'edit') })
}
