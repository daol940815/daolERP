import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { applyPrepayUse, releasePrepay } from '@/lib/prepay'

export const dynamic = 'force-dynamic'

// 선결제 사용 / 해제 (514, 2026-11-05 사용자 확정) — 영업지원팀(주문 수정 권한) 처리
//   POST   { amount, memo? }  → 원장 차감 + 수금 매칭(prepay)
//   DELETE ?match_id=         → 둘 다 삭제 (잔액 복원)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'orders', 'edit')) {
    return NextResponse.json({ error: '선결제 사용은 주문 · 발주 수정 권한이 필요합니다. 영업지원팀 홍창의 부장 또는 ERP 담당에게 요청해주세요.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { amount?: unknown; memo?: string | null }
  const r = await applyPrepayUse(createAdminClient(), params.id, body.amount, body.memo ?? null,
    { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'orders', 'edit')) {
    return NextResponse.json({ error: '선결제 사용 해제는 주문 · 발주 수정 권한이 필요합니다. 영업지원팀 홍창의 부장 또는 ERP 담당에게 요청해주세요.' }, { status: 403 })
  }
  const matchId = new URL(req.url).searchParams.get('match_id')
  if (!matchId) return NextResponse.json({ error: 'match_id가 필요합니다.' }, { status: 400 })
  const r = await releasePrepay(createAdminClient(), params.id, matchId,
    { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
