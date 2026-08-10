import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser, type CurrentUser } from '@/lib/user-role'
import {
  validateOrderInput, applyOrderEdit, resolveDisplayNames, loadOrderSnapshot,
  kstToday, kstDateOf,
} from '@/lib/orders-portal'

export const dynamic = 'force-dynamic'

// 주문 상세 / 당일 직접 수정 / 당일 삭제
// 수정 정책 (확정 설계): direct 주문만 수정 대상.
//  - 입력 당일(KST, created_at 기준)은 입력자 본인이 자유 수정·삭제
//  - manager/admin은 언제든 직접 수정 (승인권자)
//  - 그 외(익일 이후의 sales)는 수정요청 API로 — 음수 상계 주문 방식 폐지
type OrderRow = Record<string, unknown>

function editability(order: OrderRow, me: CurrentUser) {
  if (order.source !== 'direct') return { canEdit: false, needsRequest: false }
  if (me.role === 'manager' || me.role === 'admin') return { canEdit: true, needsRequest: false }
  const isOwner = !!me.employeeId && order.created_by_employee_id === me.employeeId
  const isToday = kstDateOf(String(order.created_at)) === kstToday()
  if (isOwner && isToday) return { canEdit: true, needsRequest: false }
  return { canEdit: false, needsRequest: isOwner }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

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
    can_edit: edit.canEdit,
    needs_request: edit.needsRequest,
    role: me.role,   // sales에게는 화면에서 매입가·마진 숨김
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
  const edit = editability(snap.order, me)
  if (!edit.canEdit) {
    return NextResponse.json({
      error: edit.needsRequest
        ? '입력 당일이 지난 주문입니다. 수정 요청을 올려 관리자 승인을 받아주세요.'
        : '이 주문을 수정할 권한이 없습니다.',
    }, { status: 403 })
  }

  const parsed = validateOrderInput(await req.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const names = await resolveDisplayNames(admin, parsed.input)
  if (names.error) return NextResponse.json({ error: names.error }, { status: 400 })

  const err = await applyOrderEdit(admin, params.id, parsed.input, {
    managerName: names.managerName,
    counselorName: names.counselorName,
  })
  if (err) return NextResponse.json({ error: err }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  if (snap.order.source !== 'direct') {
    return NextResponse.json({ error: '업로드 주문은 삭제할 수 없습니다. (원본 보존)' }, { status: 403 })
  }
  const edit = editability(snap.order, me)
  if (!edit.canEdit) {
    return NextResponse.json({
      error: '입력 당일이 지난 주문은 삭제 대신 취소 요청을 올려주세요.',
    }, { status: 403 })
  }

  const { error } = await admin.from('erp_orders').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: `삭제 실패: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
