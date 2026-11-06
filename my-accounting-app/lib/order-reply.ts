import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPush } from './push-server'

// ── 완료 회신 (515, 2026-11-05 사용자 확정 — 시안 docs/mockups/완료회신_시안.html) ──
// 주문 · 발주를 처리한 직원이 요청자 · 상담자에게 처리 결과를 회신한다. 회신해야 완료.
//  - 대상: 직접 입력 · 취소 안 된 주문 중 REPLY_START 이후 입력분, 받는 사람이 1명 이상
//  - 받는 사람 = {상담 주문 진행 요청자(order_requested_by), 상담자(counselor_employee_id)} − 입력자(created_by_employee_id)
//    로그인 계정 있는 재직 직원만 — 없으면 알림을 받을 수 없어 대상에서 뺀다 (사용자 결정 3)
//  - 회신은 주문 수정 권한자 누구나 (사용자 결정 4 "회신은 모두 가능하게") — 책임(할 일 · 아침 알림)은 입력자
//  - 결과: done 완료 / changed 완료(변경 있음, 메모 필수) / unable 처리 불가(메모 필수). 이력으로 쌓고 최신이 상태
//  - 처리 불가 회신은 주문을 자동 취소하지 않는다 (취소는 기존 주문 취소로 따로)
//  - 전환 전 처리 불가는 상담일지 회신(order_id NULL) — 요청이 요청자에게 되돌아감(order_assignee_id 비움)

export const REPLY_515_HINT = '515 마이그레이션(완료 회신)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
export const REPLY_START = '2026-11-06T00:00:00+09:00'   // 적용 시작 — 이 시각 이후 입력된 주문부터 (사용자 결정 1)

export type ReplyResult = 'done' | 'changed' | 'unable'
export type ReplyState = 'waiting' | ReplyResult
export const REPLY_RESULTS: ReplyResult[] = ['done', 'changed', 'unable']
export const REPLY_LABEL: Record<ReplyState, string> = {
  waiting: '회신 대기', done: '완료', changed: '변경 있음', unable: '처리 불가',
}
export const REPLY_LABEL_LONG: Record<ReplyResult, string> = {
  done: '완료', changed: '완료(변경 있음)', unable: '처리 불가',
}

export interface ReplyInfo {
  state: ReplyState
  recipients: string[]          // 받는 사람 employee id
  entrant: string | null        // 입력자 (회신 책임)
  last_at: string | null        // 최신 회신 시각
  last_by: string | null        // 최신 회신 직원 이름
  last_memo: string | null
}

interface OrderMeta {
  id: string
  source: string | null
  created_at: string
  canceled_at: string | null
  created_by_employee_id: string | null
  counselor_employee_id: string | null
  consultation_id: string | null
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)))

// 515 적용 여부
export async function has515(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('erp_order_replies').select('id').limit(1)
  return !error
}

// 회신 대상 주문의 상태 · 받는 사람. 대상이 아닌 주문은 맵에 없다. 515 미적용이면 빈 맵.
export async function loadReplyMap(admin: SupabaseClient, orderIds: string[]): Promise<Map<string, ReplyInfo>> {
  const map = new Map<string, ReplyInfo>()
  if (!orderIds.length) return map

  const metas: OrderMeta[] = []
  const ores = await Promise.all(chunk(orderIds, 150).map(ch =>
    admin.from('erp_orders')
      .select('id, source, created_at, canceled_at, created_by_employee_id, counselor_employee_id, consultation_id')
      .in('id', ch).gte('created_at', REPLY_START),
  ))
  for (const r of ores) { if (r.error) return map; metas.push(...((r.data ?? []) as OrderMeta[])) }
  const cands = metas.filter(o => (o.source ?? 'upload') === 'direct' && !o.canceled_at)
  if (!cands.length) return map

  // 상담 주문 진행 요청자
  const consultIds = uniq(cands.map(o => o.consultation_id))
  const requester = new Map<string, string>()
  if (consultIds.length) {
    const cres = await Promise.all(chunk(consultIds, 150).map(ch =>
      admin.from('erp_consultations').select('id, order_requested_by').in('id', ch),
    ))
    for (const r of cres) for (const c of r.data ?? []) if (c.order_requested_by) requester.set(c.id as string, c.order_requested_by as string)
  }

  // 받는 사람 후보 → 로그인 계정 있는 재직 직원만
  const raw = new Map<string, string[]>()
  for (const o of cands) {
    const rs = uniq([o.consultation_id ? requester.get(o.consultation_id) : null, o.counselor_employee_id])
      .filter(id => id !== o.created_by_employee_id)
    if (rs.length) raw.set(o.id, rs)
  }
  const empIds = uniq(Array.from(raw.values()).flat())
  const eligible = new Set<string>()
  if (empIds.length) {
    const eres = await Promise.all(chunk(empIds, 150).map(ch =>
      admin.from('employees').select('id, is_active, auth_user_id').in('id', ch),
    ))
    for (const r of eres) for (const e of r.data ?? []) if (e.auth_user_id && e.is_active !== false) eligible.add(e.id as string)
  }

  const targets = cands.filter(o => (raw.get(o.id) ?? []).some(id => eligible.has(id)))
  if (!targets.length) return map

  // 최신 회신
  const latest = new Map<string, { result: ReplyResult; created_at: string; employee_name: string | null; memo: string | null }>()
  const rres = await Promise.all(chunk(targets.map(o => o.id), 150).map(ch =>
    admin.from('erp_order_replies').select('order_id, result, memo, employee_name, created_at')
      .in('order_id', ch).order('created_at', { ascending: false }),
  ))
  for (const r of rres) {
    if (r.error) return map   // 515 미적용 — 기능 꺼짐
    for (const x of r.data ?? []) {
      const k = x.order_id as string
      if (!latest.has(k)) latest.set(k, { result: x.result as ReplyResult, created_at: x.created_at as string, employee_name: (x.employee_name as string) ?? null, memo: (x.memo as string) ?? null })
    }
  }

  for (const o of targets) {
    const l = latest.get(o.id)
    map.set(o.id, {
      state: l?.result ?? 'waiting',
      recipients: (raw.get(o.id) ?? []).filter(id => eligible.has(id)),
      entrant: o.created_by_employee_id,
      last_at: l?.created_at ?? null,
      last_by: l?.employee_name ?? null,
      last_memo: l?.memo ?? null,
    })
  }
  return map
}

// 주문 입력 알림 (2026-11-06 사용자 확정 — A안): 회신 받는 사람과 같은 기준(요청자 + 상담자 − 입력자)에게 "주문 입력됨".
//  - 상담일지 요청 건 · 바로 입력한 건(출력물 전달 등) 모두. 요청자 = 상담자면 1번
//  - 신규 저장 때만 — 취소 · 재등록 · 당일 수정은 보내지 않음. 대상이 아니면(받는 사람 없음 등) false
export async function notifyOrderEntered(
  admin: SupabaseClient, orderId: string, orderNo: string,
  me: { employeeId: string | null; employeeName: string | null },
): Promise<boolean> {
  const info = (await loadReplyMap(admin, [orderId])).get(orderId)
  if (!info) return false
  const to = info.recipients.filter(id => id !== me.employeeId)
  if (!to.length) return true
  const { data: o } = await admin.from('erp_orders').select('bank_name, branch_name').eq('id', orderId).maybeSingle()
  const where = [o?.bank_name, o?.branch_name].filter(Boolean).join(' ')
  await sendPush(admin, to, {
    kind: 'order_done',
    title: `주문 입력됨 — ${me.employeeName ?? ''}`,
    body: `${where} · ${orderNo} · 완료 회신 대기`,
    url: `/orders/${orderId}`,
    tag: `order_entered:${orderId}`,
  }).catch(() => null)
  return true
}

// 메모 필수 검사
export function replyInputError(result: unknown, memo: string | null): string | null {
  if (typeof result !== 'string' || !REPLY_RESULTS.includes(result as ReplyResult)) return '회신 결과를 골라주세요.'
  if (result !== 'done' && !memo) return result === 'unable' ? '처리 불가 사유를 적어주세요.' : '무엇이 바뀌었는지 회신 메모에 적어주세요.'
  return null
}

// 주문 회신 저장 + 받는 사람에게 PC 알림
export async function saveOrderReply(
  admin: SupabaseClient, orderId: string, result: ReplyResult, memo: string | null,
  me: { employeeId: string | null; employeeName: string | null },
): Promise<string | null> {
  const info = (await loadReplyMap(admin, [orderId])).get(orderId)
  if (!info) {
    if (!(await has515(admin))) return REPLY_515_HINT
    return '회신 대상 주문이 아닙니다. (상담자 = 입력자 · 취소 · 적용 시작 전 주문 · 받는 사람 계정 없음)'
  }
  const { data: o } = await admin.from('erp_orders')
    .select('order_no, bank_name, branch_name, consultation_id').eq('id', orderId).maybeSingle()
  const { error } = await admin.from('erp_order_replies').insert({
    order_id: orderId, consultation_id: o?.consultation_id ?? null, result, memo,
    employee_id: me.employeeId, employee_name: me.employeeName,
  })
  if (error) return /erp_order_replies/.test(error.message) ? REPLY_515_HINT : error.message

  const to = info.recipients.filter(id => id !== me.employeeId)
  if (to.length) {
    const where = [o?.bank_name, o?.branch_name].filter(Boolean).join(' ')
    await sendPush(admin, to, {
      kind: 'order_reply',
      title: `${result === 'unable' ? '처리 불가 회신' : '완료 회신'} — ${me.employeeName ?? ''}`,
      body: `${where} · ${o?.order_no ?? ''} · ${REPLY_LABEL_LONG[result]}${memo ? `\n${memo.slice(0, 60)}` : ''}`,
      url: `/orders/${orderId}`,
      tag: `order_reply:${orderId}`,
    }).catch(() => null)
  }
  return null
}

// 상담 회신 — 전환 전 처리 불가: 요청을 요청자에게 되돌린다
export async function saveConsultUnable(
  admin: SupabaseClient, consultId: string, memo: string | null,
  me: { employeeId: string | null; employeeName: string | null },
): Promise<string | null> {
  if (!memo) return '처리 불가 사유를 적어주세요.'
  const { data: c, error: ce } = await admin.from('erp_consultations')
    .select('id, status, bank_name, branch_name, order_assignee_id, order_requested_by').eq('id', consultId).maybeSingle()
  if (ce) return ce.message
  if (!c) return '상담일지를 찾을 수 없습니다.'
  if (c.status === '주문전환') return '이미 주문으로 전환된 상담입니다. 주문 상세에서 회신해주세요.'
  if (!c.order_assignee_id) return '주문 진행 요청이 없는 상담입니다.'
  const { error } = await admin.from('erp_order_replies').insert({
    consultation_id: consultId, order_id: null, result: 'unable', memo,
    employee_id: me.employeeId, employee_name: me.employeeName,
  })
  if (error) return /erp_order_replies/.test(error.message) ? REPLY_515_HINT : error.message
  // 요청자는 남기고 담당만 비움 → 요청자 화면 "처리 불가 — 다시 요청"
  await admin.from('erp_consultations').update({ order_assignee_id: null, order_reminded_at: null }).eq('id', consultId)

  if (c.order_requested_by && c.order_requested_by !== me.employeeId) {
    const where = [c.bank_name, c.branch_name].filter(Boolean).join(' ') || '상담일지'
    await sendPush(admin, [c.order_requested_by as string], {
      kind: 'order_reply',
      title: `처리 불가 회신 — ${me.employeeName ?? ''}`,
      body: `${where}\n${memo.slice(0, 60)}`,
      url: `/orders/consultations/${consultId}`,
      tag: `order_unable:${consultId}`,
    }).catch(() => null)
  }
  return null
}

// ── 상담 요청 상태 (상담 목록 · 상세 공용) ──────────────────
// requested 요청됨 / returned 처리 불가로 되돌아옴 / waiting 주문 입력됨(회신 대기) / done · changed · unable 회신됨
// converted = 적용 시작 전 · 회신 대상 아닌 주문으로 전환 (예전 규칙: 전환 = 완료)
export type ConsultReqState = 'requested' | 'returned' | 'waiting' | 'converted' | ReplyResult
export const CONSULT_REQ_LABEL: Record<ConsultReqState, string> = {
  requested: '요청됨', returned: '처리 불가', waiting: '회신 대기', converted: '주문 입력됨',
  done: '완료', changed: '완료(변경)', unable: '처리 불가',
}

export interface ConsultReqRow {
  id: string
  status: string | null
  order_assignee_id?: string | null
  order_requested_by?: string | null
  order_requested_at?: string | null
}
export interface ConsultReqInfo {
  state: ConsultReqState
  last_memo: string | null
  last_by: string | null
  last_at: string | null
  order_ids: string[]
}

export async function loadConsultReqMap(admin: SupabaseClient, rows: ConsultReqRow[]): Promise<Map<string, ConsultReqInfo>> {
  const map = new Map<string, ConsultReqInfo>()
  const reqRows = rows.filter(r => r.order_assignee_id || r.order_requested_by)
  if (!reqRows.length) return map
  const ids = reqRows.map(r => r.id)

  // 상담 회신(처리 불가) 최신 · 전환 주문
  const consultReply = new Map<string, { created_at: string; memo: string | null; employee_name: string | null }>()
  const ordersOf = new Map<string, string[]>()
  await Promise.all(chunk(ids, 150).map(async ch => {
    const [rp, od] = await Promise.all([
      admin.from('erp_order_replies').select('consultation_id, memo, employee_name, created_at')
        .in('consultation_id', ch).is('order_id', null).order('created_at', { ascending: false }),
      admin.from('erp_orders').select('id, consultation_id, canceled_at').in('consultation_id', ch),
    ])
    for (const x of rp.data ?? []) {
      const k = x.consultation_id as string
      if (!consultReply.has(k)) consultReply.set(k, { created_at: x.created_at as string, memo: (x.memo as string) ?? null, employee_name: (x.employee_name as string) ?? null })
    }
    for (const o of od.data ?? []) {
      if (o.canceled_at) continue
      const k = o.consultation_id as string
      ordersOf.set(k, [...(ordersOf.get(k) ?? []), o.id as string])
    }
  }))
  const replyMap = await loadReplyMap(admin, Array.from(ordersOf.values()).flat())

  for (const r of reqRows) {
    if (r.status !== '주문전환') {
      if (r.order_assignee_id) { map.set(r.id, { state: 'requested', last_memo: null, last_by: null, last_at: null, order_ids: [] }); continue }
      const cr = consultReply.get(r.id)
      if (cr && (!r.order_requested_at || Date.parse(cr.created_at) >= Date.parse(r.order_requested_at))) {
        map.set(r.id, { state: 'returned', last_memo: cr.memo, last_by: cr.employee_name, last_at: cr.created_at, order_ids: [] })
      }
      continue
    }
    const oids = ordersOf.get(r.id) ?? []
    const infos = oids.map(id => replyMap.get(id)).filter((x): x is ReplyInfo => !!x)
    if (!infos.length) { map.set(r.id, { state: 'converted', last_memo: null, last_by: null, last_at: null, order_ids: oids }); continue }
    const lastOf = infos.filter(i => i.last_at).sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))[0]
    const state: ConsultReqState = infos.some(i => i.state === 'waiting') ? 'waiting'
      : infos.some(i => i.state === 'unable') ? 'unable'
      : infos.some(i => i.state === 'changed') ? 'changed' : 'done'
    map.set(r.id, { state, last_memo: lastOf?.last_memo ?? null, last_by: lastOf?.last_by ?? null, last_at: lastOf?.last_at ?? null, order_ids: oids })
  }
  return map
}

// ── 주문 상세 회신 카드 데이터 ──────────────────────────────
export interface OrderReplyDetail {
  target: boolean
  state: ReplyState | null
  recipients: { id: string; name: string }[]
  entrant_name: string | null
  replies: { id: string; result: ReplyResult; memo: string | null; employee_name: string | null; created_at: string }[]
  pos: { po_no: string; vendor_name: string; sent_at: string | null }[]   // 처리 결과 자동 요약 — 발주처별 발송 여부
  ready: boolean   // 515 적용 여부
}

export async function loadOrderReplyDetail(admin: SupabaseClient, orderId: string): Promise<OrderReplyDetail> {
  const empty: OrderReplyDetail = { target: false, state: null, recipients: [], entrant_name: null, replies: [], pos: [], ready: false }
  const [info, rp, po] = await Promise.all([
    loadReplyMap(admin, [orderId]).then(m => m.get(orderId) ?? null),
    admin.from('erp_order_replies').select('id, result, memo, employee_name, created_at')
      .eq('order_id', orderId).order('created_at', { ascending: false }),
    admin.from('erp_purchase_orders').select('po_no, vendor_name, sent_at')
      .eq('order_id', orderId).eq('status', 'active').order('created_at'),
  ])
  if (rp.error) return empty
  const ids = uniq([...(info?.recipients ?? []), info?.entrant])
  const nm = new Map<string, string>()
  if (ids.length) {
    const { data } = await admin.from('employees').select('id, name').in('id', ids)
    for (const e of data ?? []) nm.set(e.id as string, e.name as string)
  }
  return {
    target: !!info,
    state: info?.state ?? null,
    recipients: (info?.recipients ?? []).map(id => ({ id, name: nm.get(id) ?? '' })),
    entrant_name: info?.entrant ? nm.get(info.entrant) ?? null : null,
    replies: (rp.data ?? []) as OrderReplyDetail['replies'],
    pos: (po.data ?? []) as OrderReplyDetail['pos'],
    ready: true,
  }
}
