import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser, type CurrentUser } from '@/lib/user-role'
import {
  validateOrderInput, applyOrderEdit, resolveDisplayNames, loadOrderSnapshot,
  cancelOrder, canCancelReissue, kstToday, kstDateOf,
} from '@/lib/orders-portal'
import { recordWorkLog, orderContent } from '@/lib/work-log'

export const dynamic = 'force-dynamic'

// 주문 상세 / 당일 직접 수정 / 취소 (홈택스 방식 — 2026-08-25 확정)
//  - 당일(KST, created_at 기준) 입력자 본인·manager/admin: 직접 수정 (변경 로그 기록)
//  - 익일 이후: 직접 수정 불가 → 취소·재등록 (승인 없음, 이력 보존)
//  - 삭제(DELETE)는 물리 삭제 폐지 → 취소 처리 (집계 제외로 상계)
type OrderRow = Record<string, unknown>

function editability(order: OrderRow, me: CurrentUser) {
  if (order.source !== 'direct' || order.canceled_at) return { canEdit: false }
  if (me.role === 'manager' || me.role === 'admin') return { canEdit: true }
  const isOwner = !!me.employeeId && order.created_by_employee_id === me.employeeId
  const isToday = kstDateOf(String(order.created_at)) === kstToday()
  return { canEdit: isOwner && isToday }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  // 변경 로그 (511 미적용이면 빈 목록) + 재등록 링크 주문번호
  const { data: logs } = await admin.from('erp_order_edit_logs')
    .select('id, employee_name, field_label, before_text, after_text, created_at')
    .eq('order_id', params.id).order('created_at', { ascending: false })
  const linkIds = [snap.order.reissued_to_order_id, snap.order.reissued_from_order_id]
    .filter(Boolean) as string[]
  const linkNos = new Map<string, string>()
  if (linkIds.length) {
    const { data } = await admin.from('erp_orders').select('id, order_no').in('id', linkIds)
    for (const o of data ?? []) linkNos.set(o.id as string, (o.order_no as string) ?? '')
  }

  // 과거 수정요청 이력 (제도 폐지 — 남은 기록 열람용)
  const { data: requests } = await admin
    .from('erp_order_change_requests')
    .select('id, request_type, reason, status, decision_memo, created_at, decided_at')
    .eq('order_id', params.id)
    .order('created_at', { ascending: false })

  const edit = editability(snap.order, me)
  return NextResponse.json({
    order: snap.order,
    items: snap.items,
    change_requests: requests ?? [],
    edit_logs: logs ?? [],
    can_edit: edit.canEdit,
    // 취소·재등록: 입력자 본인 + manager/admin (2026-08-25 제한 확정 — 승인은 없음)
    can_reissue: canCancelReissue(snap.order, me),
    canceled: !!snap.order.canceled_at,
    reissued_to_no: snap.order.reissued_to_order_id
      ? linkNos.get(snap.order.reissued_to_order_id as string) ?? null : null,
    reissued_from_no: snap.order.reissued_from_order_id
      ? linkNos.get(snap.order.reissued_from_order_id as string) ?? null : null,
    role: me.role,   // 매입가·마진은 전 직원 공개로 전환 (2026-08-13) — role은 참고용
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  if (snap.order.source !== 'direct') {
    return NextResponse.json({ error: '업로드 주문은 수정할 수 없습니다. (원본 보존)' }, { status: 403 })
  }
  if (snap.order.canceled_at) {
    return NextResponse.json({ error: '취소된 주문입니다. 재등록 주문에서 수정해주세요.' }, { status: 403 })
  }
  const edit = editability(snap.order, me)
  if (!edit.canEdit) {
    return NextResponse.json({
      error: '입력 당일이 지난 주문은 직접 수정 대신 취소·재등록으로 진행해주세요.',
    }, { status: 403 })
  }

  const parsed = validateOrderInput(await req.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const names = await resolveDisplayNames(admin, parsed.input)
  if (names.error) return NextResponse.json({ error: names.error }, { status: 400 })

  const result = await applyOrderEdit(admin, params.id, parsed.input, {
    managerName: names.managerName,
    counselorName: names.counselorName,
  }, { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    action: '주문수정',
    content: orderContent({
      customer: [snap.order.bank_name, snap.order.branch_name].filter(Boolean).join(' '),
      orderNo: (snap.order.order_no as string) ?? null,
      itemCount: parsed.input.items.length,
    }, '주문서 수정'),
    refType: 'order',
    refId: params.id,
  })
  return NextResponse.json({ ok: true, warning: result.warning })
}

// 주문 취소 (삭제 대체) — 물리 삭제 없이 취소 처리, 원본·이력 보존
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  if (snap.order.source !== 'direct') {
    return NextResponse.json({ error: '업로드 주문은 취소할 수 없습니다. (원본 보존)' }, { status: 403 })
  }
  if (snap.order.canceled_at) {
    return NextResponse.json({ error: '이미 취소된 주문입니다.' }, { status: 400 })
  }
  if (!canCancelReissue(snap.order, me)) {
    return NextResponse.json({ error: '본인이 입력한 주문만 취소할 수 있습니다. (관리자 제외)' }, { status: 403 })
  }

  const reason = new URL(req.url).searchParams.get('reason')
  const err = await cancelOrder(admin, params.id, {
    employeeId: me.employeeId, employeeName: me.employeeName,
  }, reason || null)
  if (err) return NextResponse.json({ error: err }, { status: 500 })

  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    // erp_work_logs.action CHECK(700 트랙) 범위 내에서 기재 — 내용으로 취소를 구분
    action: '주문수정',
    content: orderContent({
      customer: [snap.order.bank_name, snap.order.branch_name].filter(Boolean).join(' '),
      orderNo: (snap.order.order_no as string) ?? null,
      itemCount: snap.items.length,
    }, reason ? `주문 취소 (${reason})` : '주문 취소'),
    refType: 'order',
    refId: params.id,
  })
  return NextResponse.json({ ok: true })
}
