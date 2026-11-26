import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadWorkload } from '@/lib/consult-status'

export const dynamic = 'force-dynamic'

// GET — 직원별 업무량 { workload: { [employeeId]: { req: 요청 대기, orders: 진행 중 주문(발주 미완료) } } }
// 주문 진행 담당을 고를 때(처음 요청 · 전달 · 재요청) 이름 옆에 보여준다 (2026-11-26 사용자 승인)
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const workload = await loadWorkload(createAdminClient())
  return NextResponse.json({ workload })
}
