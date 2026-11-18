import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { loadOverview, loadStaffScope } from '@/lib/payment-overview'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 결제 확인 › 전체 현황 (2026-11-18) — 직접 입력 주문(취소 제외) 전부를 결제 상태 · 지점 담당과 함께 내려 준다. 거르기는 화면에서.
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const r = await loadOverview(admin)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ...r, scope: await loadStaffScope(admin, me), can_edit: can(me, 'collections', 'edit') })
}
