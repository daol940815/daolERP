import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { saveOrderReply, replyInputError, type ReplyResult } from '@/lib/order-reply'

export const dynamic = 'force-dynamic'

// 완료 회신 (515, 2026-11-05 사용자 확정) — 주문 수정 권한자 누구나 회신 가능 ("회신은 모두 가능하게")
//   POST { result: 'done'|'changed'|'unable', memo? } → 회신 이력 추가 + 요청자 · 상담자 PC 알림
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'orders', 'edit')) {
    return NextResponse.json({ error: '완료 회신은 주문 · 발주 수정 권한이 필요합니다. 영업지원팀 홍창의 부장 또는 ERP 담당에게 요청해주세요.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { result?: unknown; memo?: unknown }
  const memo = String(body.memo ?? '').trim() || null
  const bad = replyInputError(body.result, memo)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  const err = await saveOrderReply(createAdminClient(), params.id, body.result as ReplyResult, memo,
    { employeeId: me.employeeId, employeeName: me.employeeName })
  if (err) return NextResponse.json({ error: err }, { status: 400 })
  return NextResponse.json({ ok: true })
}
