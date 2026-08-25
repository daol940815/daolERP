import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

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

export async function POST() {
  // 수정요청 제도 폐지 (2026-08-25 취소·재등록 확정) — 신규 접수는 받지 않는다.
  // 잔여 pending 요청의 승인·반려([id] 라우트)와 이력 조회(GET)는 유지.
  return NextResponse.json({
    error: '수정요청 제도가 취소·재등록 방식으로 대체되었습니다. 주문 상세에서 취소·재등록으로 진행해주세요.',
  }, { status: 400 })
}
