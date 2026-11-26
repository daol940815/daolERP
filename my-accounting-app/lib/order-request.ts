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

// 요청 이력 (711, 2026-11-26 사용자 승인 — 시안 docs/mockups/상담_요청흐름_시안.html):
//  - 진행자가 다른 직원에게 '전달'(사유 필수), 요청자가 '재요청'(사유 필수) · '요청 취소'(사유 선택)
//  - 요청자(order_requested_by)는 전달 · 재요청해도 바뀌지 않는다 — 처음 요청한 사람이 끝까지 진행을 본다
//  - 이력 표 erp_consult_request_events 미적용이면 기록 없이 동작
export const REQ_711_HINT = '711 마이그레이션(요청 이력)이 아직 적용되지 않아 이력은 남지 않았습니다.'
export type RequestEventKind = 'request' | 'transfer' | 'rerequest' | 'cancel'

type Row = Record<string, unknown>
export interface OrderRequestInput { assignee_id: string | null; memo: string | null; reason?: string | null }

export async function logRequestEvent(admin: SupabaseClient, ev: {
  consultation_id: string; kind: RequestEventKind; from: string | null; to: string | null
  by: string | null; byName: string | null; reason: string | null
}): Promise<void> {
  await admin.from('erp_consult_request_events').insert({
    consultation_id: ev.consultation_id, kind: ev.kind, from_employee_id: ev.from, to_employee_id: ev.to,
    by_employee_id: ev.by, by_name: ev.byName, reason: ev.reason,
  }).then(() => null, () => null)   // 711 미적용이면 조용히 건너뜀
}

async function activeEmployee(admin: SupabaseClient, id: string): Promise<{ id: string; name: string } | null> {
  const { data: emp } = await admin.from('employees').select('id, name, is_active').eq('id', id).maybeSingle()
  return emp && emp.is_active !== false ? { id: emp.id as string, name: emp.name as string } : null
}

export function parseOrderRequest(raw: unknown): OrderRequestInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return {
    assignee_id: typeof r.assignee_id === 'string' && r.assignee_id ? r.assignee_id : null,
    memo: String(r.memo ?? '').trim() || null,
    reason: String(r.reason ?? '').trim() || null,
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
    .select('id, status, vendor_id, contact_id, bank_name, branch_name, order_assignee_id, order_request_memo, order_requested_by')
    .eq('id', consultId).maybeSingle()
  if (error) return /order_/.test(error.message) ? ORDER_REQ_705_HINT : error.message
  if (!c) return '상담일지를 찾을 수 없습니다.'
  const sameAssignee = (c.order_assignee_id ?? null) === input.assignee_id
  if (sameAssignee && (c.order_request_memo ?? null) === input.memo) return null
  if (c.status === '주문전환') return '주문으로 전환된 상담은 주문 진행 요청을 바꿀 수 없습니다.'

  // 이미 요청이 있었는데(진행 중이거나 처리 불가로 되돌아옴) 다른 직원으로 바꾸면 재요청 — 사유 필수 (711)
  const prevAssignee = (c.order_assignee_id as string | null) ?? null
  const isRerequest = !!input.assignee_id && !sameAssignee && (!!prevAssignee || !!c.order_requested_by)
  if (isRerequest && !input.reason) return '다시 요청하는 사유를 적어주세요.'
  if (input.assignee_id) {
    const { data: emp } = await admin.from('employees')
      .select('id, name, is_active, employment_type').eq('id', input.assignee_id).maybeSingle()
    if (!emp || emp.is_active === false) return '주문 진행 담당으로 고를 수 없는 직원입니다.'
    // 마스터 미연결 상담은 요청 불가 (2026-11-19 사용자 결정 — 다안, 전에는 아르바이트만 막았다):
    // 요청받은 직원은 상담을 열람 · 전환만 할 수 있어 연결을 못 하고, 전환 버튼은 지점 · 담당자 연결이 끝나야 켜진다.
    // 요청 취소(담당 비우기)는 막지 않는다.
    if (!masterLinked(c)) {
      return '이 상담은 주문처 · 담당자가 마스터에 연결되지 않았습니다. 요청받은 직원은 상담을 고칠 수 없어 주문서로 전환하지 못합니다 — 상담일지에서 지점 · 담당자를 마스터에서 고르거나 등록한 뒤 요청하세요.'
    }
  }

  const patch = input.assignee_id
    ? {
        order_assignee_id: input.assignee_id,
        order_request_memo: input.memo,
        // 담당자가 바뀔 때만 요청 시각 · 재알림을 새로. 요청자는 처음 요청한 사람 유지 (711)
        ...(sameAssignee ? {} : { order_requested_by: (c.order_requested_by as string | null) ?? me.employeeId, order_requested_at: new Date().toISOString(), order_reminded_at: null }),
      }
    : { order_assignee_id: null, order_request_memo: null, order_requested_by: null, order_requested_at: null, order_reminded_at: null }
  const { error: ue } = await admin.from('erp_consultations').update(patch).eq('id', consultId)
  if (ue) return /order_/.test(ue.message) ? ORDER_REQ_705_HINT : ue.message

  const where = [c.bank_name, c.branch_name].filter(Boolean).join(' ') || '상담일지'
  if (!sameAssignee) {
    // 이력 (711)
    if (input.assignee_id) {
      await logRequestEvent(admin, {
        consultation_id: consultId, kind: isRerequest ? 'rerequest' : 'request', from: prevAssignee, to: input.assignee_id,
        by: me.employeeId, byName: me.employeeName, reason: isRerequest ? input.reason ?? null : input.memo,
      })
    } else if (prevAssignee) {
      await logRequestEvent(admin, {
        consultation_id: consultId, kind: 'cancel', from: prevAssignee, to: null,
        by: me.employeeId, byName: me.employeeName, reason: input.reason ?? null,
      })
    }
  }
  if (input.assignee_id && !sameAssignee && input.assignee_id !== me.employeeId) {
    await sendPush(admin, [input.assignee_id], {
      kind: 'order_req',
      title: `주문 진행 요청 — ${me.employeeName ?? ''}`,
      body: `${where}${input.memo ? ` — "${input.memo.slice(0, 40)}"` : ''}${isRerequest && input.reason ? `\n재요청 사유: ${input.reason.slice(0, 40)}` : ''}`,
      url: `/orders/consultations/${consultId}`,
      tag: `order_req:${consultId}`,
    }).catch(() => null)
  }
  // 이전 진행자에게: 다른 직원에게 다시 요청됨 / 요청 취소됨
  if (prevAssignee && !sameAssignee && prevAssignee !== me.employeeId) {
    await sendPush(admin, [prevAssignee], {
      kind: 'order_req',
      title: input.assignee_id ? `주문 진행 요청이 다른 직원에게 넘어갔습니다 — ${me.employeeName ?? ''}` : `주문 진행 요청 취소 — ${me.employeeName ?? ''}`,
      body: `${where}${input.reason ? ` — "${input.reason.slice(0, 40)}"` : ''}`,
      url: '/orders/consultations?scope=assigned',
      tag: `order_req:${consultId}`,
    }).catch(() => null)
  }
  return null
}

// 진행자가 다른 직원에게 전달 (711) — 사유 필수. 요청자는 그대로, 새 진행자와 요청자에게 알림
export async function transferOrderRequest(
  admin: SupabaseClient, consultId: string, toId: string, reason: string | null,
  me: { employeeId: string | null; employeeName: string | null }, opts: { manager: boolean },
): Promise<string | null> {
  if (!reason) return '전달하는 사유를 적어주세요.'
  const { data: c, error } = await admin.from('erp_consultations')
    .select('id, status, bank_name, branch_name, order_assignee_id, order_requested_by, deleted_at').eq('id', consultId).maybeSingle()
  if (error) return /order_/.test(error.message) ? ORDER_REQ_705_HINT : error.message
  if (!c) return '상담일지를 찾을 수 없습니다.'
  if (c.status !== '진행중') return '진행중인 상담만 전달할 수 있습니다.'
  const cur = (c.order_assignee_id as string | null) ?? null
  if (!cur) return '주문 진행 요청이 없는 상담입니다.'
  if (cur !== me.employeeId && !opts.manager) return '나에게 요청된 상담만 다른 직원에게 전달할 수 있습니다.'
  if (toId === cur) return '지금 진행자와 같은 직원입니다.'
  const to = await activeEmployee(admin, toId)
  if (!to) return '전달받을 수 없는 직원입니다.'
  const { error: ue } = await admin.from('erp_consultations')
    .update({ order_assignee_id: toId, order_reminded_at: null }).eq('id', consultId)
  if (ue) return ue.message
  await logRequestEvent(admin, { consultation_id: consultId, kind: 'transfer', from: cur, to: toId, by: me.employeeId, byName: me.employeeName, reason })
  const where = [c.bank_name, c.branch_name].filter(Boolean).join(' ') || '상담일지'
  if (toId !== me.employeeId) {
    await sendPush(admin, [toId], {
      kind: 'order_req',
      title: `주문 진행 요청 전달 — ${me.employeeName ?? ''}`,
      body: `${where}\n전달 사유: ${reason.slice(0, 50)}`,
      url: `/orders/consultations/${consultId}`,
      tag: `order_req:${consultId}`,
    }).catch(() => null)
  }
  const requester = (c.order_requested_by as string | null) ?? null
  if (requester && requester !== me.employeeId) {
    await sendPush(admin, [requester], {
      kind: 'order_reply',
      title: `요청이 ${to.name}에게 전달됨 — ${me.employeeName ?? ''}`,
      body: `${where}\n${reason.slice(0, 50)}`,
      url: `/orders/consultations/${consultId}`,
      tag: `order_transfer:${consultId}`,
    }).catch(() => null)
  }
  return null
}

// ── 진행 이력 (상세 화면) — 711 이력 + 처리 불가 · 주문 입력 · 완료 회신(515)을 시간순으로 ──
export interface RequestHistoryItem {
  kind: RequestEventKind | 'unable' | 'order' | 'reply'
  at: string
  by: string | null           // 한 사람 이름
  from: string | null         // 이전 진행자 이름
  to: string | null           // 새 진행자 이름
  text: string | null         // 사유 · 메모 · 주문번호 · 회신 결과
  order_id?: string | null
}
export async function loadRequestHistory(admin: SupabaseClient, consult: Row): Promise<{ items: RequestHistoryItem[]; has711: boolean }> {
  const id = consult.id as string
  const [evRes, repRes, ordRes] = await Promise.all([
    admin.from('erp_consult_request_events').select('kind, from_employee_id, to_employee_id, by_employee_id, by_name, reason, created_at')
      .eq('consultation_id', id).order('created_at'),
    admin.from('erp_order_replies').select('order_id, result, memo, employee_name, created_at').eq('consultation_id', id).order('created_at'),
    admin.from('erp_orders').select('id, order_no, created_at, canceled_at, created_by_employee_id, staff_name').eq('consultation_id', id).order('created_at'),
  ])
  const has711 = !evRes.error
  const events = (evRes.data ?? []) as Row[]
  const orders = ((ordRes.data ?? []) as Row[])
  const empIds = new Set<string>()
  for (const e of events) for (const k of ['from_employee_id', 'to_employee_id', 'by_employee_id']) if (e[k]) empIds.add(e[k] as string)
  for (const k of ['order_requested_by', 'order_assignee_id']) if (consult[k]) empIds.add(consult[k] as string)
  for (const o of orders) if (o.created_by_employee_id) empIds.add(o.created_by_employee_id as string)
  const names = new Map<string, string>()
  if (empIds.size) {
    const { data } = await admin.from('employees').select('id, name').in('id', Array.from(empIds))
    for (const e of data ?? []) names.set(e.id as string, e.name as string)
  }
  const nm = (v: unknown) => (v ? names.get(v as string) ?? null : null)
  const items: RequestHistoryItem[] = events.map(e => ({
    kind: e.kind as RequestEventKind, at: e.created_at as string,
    by: (e.by_name as string | null) ?? nm(e.by_employee_id), from: nm(e.from_employee_id), to: nm(e.to_employee_id),
    text: (e.reason as string | null) ?? null,
  }))
  // 711 이전 요청: 이력이 없으면 지금 값으로 '요청' 한 줄
  if (!events.length && consult.order_requested_by && consult.order_requested_at) {
    items.push({
      kind: 'request', at: consult.order_requested_at as string, by: nm(consult.order_requested_by), from: null,
      to: nm(consult.order_assignee_id), text: (consult.order_request_memo as string | null) ?? null,
    })
  }
  const LABEL: Record<string, string> = { done: '완료', changed: '완료(변경 있음)', unable: '처리 불가' }
  for (const r of (repRes.data ?? []) as Row[]) {
    items.push({
      kind: r.order_id ? 'reply' : 'unable', at: r.created_at as string, by: (r.employee_name as string | null) ?? null,
      from: null, to: null, text: r.order_id ? `${LABEL[r.result as string] ?? r.result}${r.memo ? ` — ${r.memo}` : ''}` : (r.memo as string | null) ?? null,
      order_id: (r.order_id as string | null) ?? null,
    })
  }
  for (const o of orders) {
    items.push({
      kind: 'order', at: o.created_at as string, by: nm(o.created_by_employee_id) ?? (o.staff_name as string | null) ?? null,
      from: null, to: null, text: `${o.order_no as string}${o.canceled_at ? ' (취소됨)' : ''}`, order_id: o.id as string,
    })
  }
  items.sort((a, b) => a.at.localeCompare(b.at))
  return { items, has711 }
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
