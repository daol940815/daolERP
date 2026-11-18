import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { loadGuideRows } from '@/lib/payment-guide'
import { loadStaffScope } from '@/lib/payment-overview'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 결제 안내 대상 (결제 확인 3단계) — 결제 상태가 미결제 · 일부 결제인 주문 + 최근 연락 기록
// GET /api/payment-records/guide   (권한: 수금 · 정산 작업 조회 — 미들웨어. 연락 기록 입력은 주문 · 발주 수정)
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const r = await loadGuideRows(admin, me.employeeId)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ...r, scope: await loadStaffScope(admin, me), can_contact: r.contacts_available && can(me, 'orders', 'edit') })
}
