import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { validateOrderInput, loadOrderSnapshot } from '@/lib/orders-portal'

export const dynamic = 'force-dynamic'

// 주문 수정·취소 요청 (익일 이후 sales 주문의 수정 경로)
// GET  ?status=pending|all  → manager/admin: 전체 / sales: 본인 요청만
// POST { order_id, request_type: 'edit'|'cancel', reason, payload? }
//   - edit: payload = OrderInput (제안값 전체). cancel: payload 없음
//   - 주문당 대기 중 요청은 1건만

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const status = new URL(req.url).searchParams.get('status') ?? 'pending'

  let query = admin
    .from('erp_order_change_requests')
    .select(`
      id, order_id, request_type, reason, payload, before_snapshot, status,
      decision_memo, created_at, decided_at,
      requester:employees!erp_order_change_requests_requested_by_fkey(id, name),
      decider:employees!erp_order_change_requests_decided_by_fkey(id, name),
      order:erp_orders(id, order_no, order_date, bank_name, branch_name, total_amount)
    `)
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'all') query = query.eq('status', status)
  if (me.role === 'sales') {
    if (!me.employeeId) return NextResponse.json({ requests: [] })
    query = query.eq('requested_by', me.employeeId)
  }

  const { data, error } = await query
  if (error) {
    const missing = /relation|erp_order_change_requests|does not exist/i.test(error.message)
    return NextResponse.json({
      error: missing ? '500 마이그레이션(수정요청)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.' : error.message,
    }, { status: 500 })
  }
  return NextResponse.json({ requests: data ?? [] })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const orderId = String(body.order_id ?? '')
  const requestType = String(body.request_type ?? '')
  const reason = String(body.reason ?? '').trim()
  if (!orderId) return NextResponse.json({ error: 'order_id가 필요합니다.' }, { status: 400 })
  if (!['edit', 'cancel'].includes(requestType)) {
    return NextResponse.json({ error: 'request_type은 edit 또는 cancel이어야 합니다.' }, { status: 400 })
  }
  if (!reason) return NextResponse.json({ error: '요청 사유를 입력해주세요.' }, { status: 400 })

  const snap = await loadOrderSnapshot(admin, orderId)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  if (snap.order.source !== 'direct') {
    return NextResponse.json({ error: '업로드 주문은 수정 요청 대상이 아닙니다.' }, { status: 403 })
  }
  if (me.role === 'sales' && (!me.employeeId || snap.order.created_by_employee_id !== me.employeeId)) {
    return NextResponse.json({ error: '본인이 입력한 주문만 수정 요청할 수 있습니다.' }, { status: 403 })
  }

  const { data: pending } = await admin
    .from('erp_order_change_requests')
    .select('id').eq('order_id', orderId).eq('status', 'pending').limit(1)
  if (pending?.length) {
    return NextResponse.json({ error: '이미 대기 중인 요청이 있습니다. 처리 후 다시 올려주세요.' }, { status: 409 })
  }

  let payload: unknown = null
  if (requestType === 'edit') {
    const parsed = validateOrderInput(body.payload)
    if ('error' in parsed) return NextResponse.json({ error: `제안 내용 오류: ${parsed.error}` }, { status: 400 })
    payload = parsed.input
  }

  const { data, error } = await admin.from('erp_order_change_requests').insert({
    order_id: orderId,
    request_type: requestType,
    requested_by: me.employeeId,
    reason,
    before_snapshot: snap,
    payload,
  }).select('id').single()
  if (error) {
    const missing = /relation|erp_order_change_requests|does not exist/i.test(error.message)
    return NextResponse.json({
      error: missing ? '500 마이그레이션(수정요청)이 아직 적용되지 않았습니다.' : `요청 저장 실패: ${error.message}`,
    }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}
