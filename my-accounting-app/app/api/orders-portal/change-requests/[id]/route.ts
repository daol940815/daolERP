import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import {
  validateOrderInput, applyOrderEdit, resolveDisplayNames,
} from '@/lib/orders-portal'

export const dynamic = 'force-dynamic'

// 수정·취소 요청 처리
// PATCH { action: 'approve' | 'reject' | 'withdraw', memo? }
//  - approve/reject: manager/admin. approve는 제안 내용을 주문에 반영
//  - withdraw: 요청자 본인이 대기 중 요청을 철회
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { action?: string; memo?: string }

  const { data: reqRow, error: rErr } = await admin
    .from('erp_order_change_requests')
    .select('id, order_id, request_type, requested_by, payload, status')
    .eq('id', params.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  if (!reqRow) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 })
  if (reqRow.status !== 'pending') {
    return NextResponse.json({ error: '이미 처리된 요청입니다.' }, { status: 409 })
  }

  if (body.action === 'withdraw') {
    if (!me.employeeId || reqRow.requested_by !== me.employeeId) {
      return NextResponse.json({ error: '본인 요청만 철회할 수 있습니다.' }, { status: 403 })
    }
    const { error } = await admin.from('erp_order_change_requests')
      .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
      .eq('id', params.id).eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action은 approve/reject/withdraw 중 하나여야 합니다.' }, { status: 400 })
  }
  if (me.role === 'sales') {
    return NextResponse.json({ error: '승인·반려는 관리자 권한이 필요합니다.' }, { status: 403 })
  }

  if (body.action === 'approve') {
    if (reqRow.request_type === 'edit') {
      const parsed = validateOrderInput(reqRow.payload)
      if ('error' in parsed) {
        return NextResponse.json({ error: `제안 내용이 손상되었습니다: ${parsed.error}` }, { status: 400 })
      }
      const names = await resolveDisplayNames(admin, parsed.input)
      if (names.error) return NextResponse.json({ error: names.error }, { status: 400 })
      // 잔여 pending 요청 처리용 — 신규 요청은 취소·재등록 방식 도입으로 더 받지 않는다
      const result = await applyOrderEdit(admin, reqRow.order_id as string, parsed.input, {
        managerName: names.managerName,
        counselorName: names.counselorName,
      }, { employeeId: me.employeeId, employeeName: me.employeeName })
      if ('error' in result) return NextResponse.json({ error: `반영 실패: ${result.error}` }, { status: 500 })
    } else {
      // 취소 승인: 품목 전체 취소 처리 + 금액 0. 원본 행은 남겨 이력 보존.
      const { error: iErr } = await admin.from('erp_order_items')
        .update({ is_canceled: true }).eq('order_id', reqRow.order_id)
      if (iErr) return NextResponse.json({ error: `품목 취소 실패: ${iErr.message}` }, { status: 500 })
      const { error: oErr } = await admin.from('erp_orders')
        .update({ total_amount: 0, outstanding_amount: 0, etc: '[주문취소 승인]' })
        .eq('id', reqRow.order_id)
      if (oErr) return NextResponse.json({ error: `주문 취소 실패: ${oErr.message}` }, { status: 500 })
    }
  }

  const { error } = await admin.from('erp_order_change_requests').update({
    status: body.action === 'approve' ? 'approved' : 'rejected',
    decided_by: me.employeeId,
    decided_at: new Date().toISOString(),
    decision_memo: (body.memo ?? '').trim() || null,
  }).eq('id', params.id).eq('status', 'pending')
  if (error) return NextResponse.json({ error: `상태 갱신 실패: ${error.message}` }, { status: 500 })

  return NextResponse.json({ ok: true })
}
