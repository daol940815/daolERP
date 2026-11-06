import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPush } from './push-server'

// ── 상담일지 주문 진행 요청 (705, 2026-11-05 사용자 확정 — 시안 docs/mockups/주문진행요청_시안.html) ──
// 상담만 하고 주문 입력은 다른 직원에게 맡긴다.
//  - 담당자 = 전 직원 중 1명 (재직 · 로그인 계정 무관) · 요청 = 상담 작성자 또는 관리자급
//  - 요청받은 직원은 그 상담을 열람 · 주문 전환만 할 수 있다 (상담 수정 · 삭제 · 종결 불가)
//  - 상담이 주문으로 전환되면(status '주문전환') "주문 입력됨" 알림 — 완료는 담당의 완료 회신(515, lib/order-reply.ts)으로
//  - 아르바이트에게는 마스터(주문처 · 담당자) 연결된 상담만 요청 가능 — 신규 등록이 막혀 전환을 끝낼 수 없음
//  - 알림: 요청 시 담당자에게 PC 알림(order_req), 미처리면 다음 날 아침 09:00 크론이 1회 더(order_reminded_at)

export const ORDER_REQ_705_HINT = '705 마이그레이션(주문 진행 요청)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

type Row = Record<string, unknown>
export interface OrderRequestInput { assignee_id: string | null; memo: string | null }

export function parseOrderRequest(raw: unknown): OrderRequestInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return {
    assignee_id: typeof r.assignee_id === 'string' && r.assignee_id ? r.assignee_id : null,
    memo: String(r.memo ?? '').trim() || null,
  }
}

const masterLinked = (c: Row) => !!c.vendor_id && !!c.contact_id
const isAssignee = (c: Row, employeeId: string | null | undefined) =>
  !!employeeId && !!c.order_assignee_id && c.order_assignee_id === employeeId
export { isAssignee as isOrderAssignee }

// 요청 저장 — 바뀐 게 없으면 아무것도 하지 않는다. 담당자가 바뀌면 새 담당자에게 알림, 비우면 요청 취소.
export async function saveOrderRequest(
  admin: SupabaseClient,
  consultId: string,
  input: OrderRequestInput,
  me: { employeeId: string | null; employeeName: string | null },
): Promise<string | null> {
  const { data: c, error } = await admin.from('erp_consultations')
    .select('id, status, vendor_id, contact_id, bank_name, branch_name, order_assignee_id, order_request_memo')
    .eq('id', consultId).maybeSingle()
  if (error) return /order_/.test(error.message) ? ORDER_REQ_705_HINT : error.message
  if (!c) return '상담일지를 찾을 수 없습니다.'
  const sameAssignee = (c.order_assignee_id ?? null) === input.assignee_id
  if (sameAssignee && (c.order_request_memo ?? null) === input.memo) return null
  if (c.status === '주문전환') return '주문으로 전환된 상담은 주문 진행 요청을 바꿀 수 없습니다.'

  if (input.assignee_id) {
    const { data: emp } = await admin.from('employees')
      .select('id, name, is_active, employment_type').eq('id', input.assignee_id).maybeSingle()
    if (!emp || emp.is_active === false) return '주문 진행 담당으로 고를 수 없는 직원입니다.'
    if (emp.employment_type === 'parttime' && !masterLinked(c)) {
      return '이 상담은 주문처 · 담당자가 마스터에 연결되지 않았습니다. 아르바이트는 신규 거래처 · 담당자 등록이 막혀 있어 전환할 수 없습니다 — 먼저 연결하거나 다른 직원에게 요청하세요.'
    }
  }

  const patch = input.assignee_id
    ? {
        order_assignee_id: input.assignee_id,
        order_request_memo: input.memo,
        // 담당자가 바뀔 때만 요청 시각 · 요청자 · 재알림을 새로
        ...(sameAssignee ? {} : { order_requested_by: me.employeeId, order_requested_at: new Date().toISOString(), order_reminded_at: null }),
      }
    : { order_assignee_id: null, order_request_memo: null, order_requested_by: null, order_requested_at: null, order_reminded_at: null }
  const { error: ue } = await admin.from('erp_consultations').update(patch).eq('id', consultId)
  if (ue) return /order_/.test(ue.message) ? ORDER_REQ_705_HINT : ue.message

  if (input.assignee_id && !sameAssignee && input.assignee_id !== me.employeeId) {
    const where = [c.bank_name, c.branch_name].filter(Boolean).join(' ') || '상담일지'
    await sendPush(admin, [input.assignee_id], {
      kind: 'order_req',
      title: `주문 진행 요청 — ${me.employeeName ?? ''}`,
      body: `${where}${input.memo ? ` — "${input.memo.slice(0, 40)}"` : ''}`,
      url: `/orders/consultations/${consultId}`,
      tag: `order_req:${consultId}`,
    }).catch(() => null)
  }
  return null
}

// 주문 전환 → 요청자에게 "주문 입력됨" 알림 (요청자가 직접 전환했으면 생략). 완료는 완료 회신(515)
export async function notifyOrderRequestDone(
  admin: SupabaseClient, consultId: string, orderId: string, orderNo: string,
  me: { employeeId: string | null; employeeName: string | null },
): Promise<void> {
  const { data: c } = await admin.from('erp_consultations')
    .select('order_assignee_id, order_requested_by, bank_name, branch_name').eq('id', consultId).maybeSingle()
  if (!c?.order_assignee_id || !c.order_requested_by || c.order_requested_by === me.employeeId) return
  const where = [c.bank_name, c.branch_name].filter(Boolean).join(' ')
  await sendPush(admin, [c.order_requested_by as string], {
    kind: 'order_done',
    title: `주문 입력됨 — ${me.employeeName ?? ''}`,
    body: `${where} · ${orderNo} · 완료 회신 대기`,
    url: `/orders/${orderId}`,
    tag: `order_done:${orderId}`,
  }).catch(() => null)
}
