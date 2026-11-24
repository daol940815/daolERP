import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike, isHrAdmin } from '@/lib/permissions'
import { OPEN_STATUSES, ASG_TRACKED, ASG_ACTIVE, fmtDue, type WrStatus, type WrAsgStatus } from '@/lib/work-requests'
import type { NotifData, NotifItem, NotifBucket } from '@/lib/notifications'
import { leaveActions, type LeaveStep } from '@/lib/leave-approval'
import { loadApprovalCtx, loadSteps } from '@/lib/leave-approval.server'
import { firstTagLabels } from '@/lib/work-requests-server'
import { loadReplyMap, loadConsultReqMap, REPLY_START, REPLY_LABEL_LONG, type ReplyResult, type ConsultReqRow } from '@/lib/order-reply'

export const dynamic = 'force-dynamic'

// GET /api/notifications — 로그인 직원의 "확인할 것" (저장 없음, 원본 상태에서 계산). API_OWNERS: my(전원).
//  원천: 업무 요청(받은 미확인·오늘 마감·지남 / 보낸 완료 확정 대기·반려 / 진행 메모·이력·완료 확정·취소 결과 통지) · 휴가 결재 내 차례(3단계 결재, 204 미적용 시 승인권자) · 주문 수정 승인 요청(승인권자)
//        · 내 휴가 신청 결과 · 내 주문 수정 요청 결과 (최근 7일). 각 블록은 마이그레이션 미적용 시 조용히 건너뛴다.
//  확인한 결과 통지 숨김(905, 2026-11-17): notification_reads 에 남긴 key · '모두 확인' 시각 이전 결과 통지(info)는 내려주지 않는다.
//   해야 할 것 · 기다리는 것은 숨기지 않는다(일이 끝나야 사라짐). 저장은 POST /api/notifications/read.

const DAY = 86400_000
const kstDay = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
const latest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null
const LEAVE_LABEL: Record<string, string> = { annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)', sick: '병가', official: '공가', unpaid: '무급휴가', other: '기타' }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const now = new Date()
  const nowIso = now.toISOString()
  const empty: NotifData = { at: nowIso, count: 0, breakdown: { personal: 0, shared: 0, mine: 0, order: 0, other: 0 }, items: [], badges: {} }
  const empId = me.employeeId
  if (!empId) return NextResponse.json(empty)

  const admin = createAdminClient()
  const items: NotifItem[] = []
  const badges: NotifData['badges'] = {}
  const breakdown: Record<NotifBucket, number> = { personal: 0, shared: 0, mine: 0, order: 0, other: 0 }
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY).toISOString()
  const today = kstDay(nowIso)
  const approver = isManagerLike(me)

  type WR = { id: string; title: string; status: WrStatus; assign_mode: 'single' | 'first' | 'all' | null; due_at: string; created_at: string; reported_at: string | null; rejected_at: string | null; reject_reason: string | null; is_urgent: boolean; requester: { name: string } | { name: string }[] | null; assignee: { name: string } | { name: string }[] | null }
  // 902: 받은 요청은 내 몫(담당자 행) 기준 — 선착에서 해제된 건·공동에서 내가 이미 보고한 건은 세지 않는다
  type MyShare = { status: WrAsgStatus; request: WR | WR[] | null }
  type Leave = { id: string; employee_id: string; leave_type: string; start_date: string; end_date: string; status: string; created_at: string; decided_at: string | null; employees: { name: string } | { name: string }[] | null }
  type OCR = { id: string; request_type: string; status: string; created_at: string; decided_at: string | null; requested_by: string | null; employees: { name: string } | { name: string }[] | null }

  const wrSel = 'id, title, status, assign_mode, due_at, created_at, reported_at, rejected_at, reject_reason, is_urgent, requester:employees!work_requests_requester_id_fkey(name), assignee:employees!work_requests_assignee_id_fkey(name)'
  const [inRes, relRes, outRes, leavePendRes, leaveMineRes, ocrPendRes, ocrMineRes, appr, readRes] = await Promise.all([
    admin.from('work_request_assignees').select(`status, request:work_requests!inner(${wrSel})`).eq('employee_id', empId).in('status', ASG_TRACKED),
    // 진행 메모 · 이력 알림 대상 넓힘(2026-11-09): 열린 요청 전부 + 최근 7일 완료 확정 · 취소된 요청 (회사 전체, 담당자 행만) — 여기서 내 몫을 가른다.
    //  ① 내가 이미 처리 보고한 열린 요청(요청자 후속 메모) ② 내가 담당이던 요청의 완료 확정 · 취소
    admin.from('work_requests').select('id, status, assign_mode, assignees:work_request_assignees(employee_id, status)')
      .or(`status.in.(${OPEN_STATUSES.join(',')}),and(status.eq.completed,completed_at.gte.${sevenDaysAgo}),and(status.eq.canceled,canceled_at.gte.${sevenDaysAgo})`).limit(1000),
    // 내가 요청한 것: 열린 건 전부(진행 메모 알림용) + 최근 7일 반려
    admin.from('work_requests').select(wrSel).eq('requester_id', empId).or(`status.in.(${OPEN_STATUSES.join(',')}),and(status.eq.rejected,rejected_at.gte.${sevenDaysAgo})`).order('created_at', { ascending: false }),
    // 진행 중 휴가 — 3단계 결재(204)면 결재 단계가 있는 사람, 아니면 기존 승인권자만 실제로 쓴다
    admin.from('attendance_leaves').select('id, employee_id, leave_type, start_date, end_date, status, created_at, decided_at, employees!attendance_leaves_employee_id_fkey(name)').eq('status', 'requested').neq('employee_id', empId).order('created_at'),
    admin.from('attendance_leaves').select('id, employee_id, leave_type, start_date, end_date, status, created_at, decided_at, employees!attendance_leaves_employee_id_fkey(name)').eq('employee_id', empId).in('status', ['approved', 'rejected']).gte('decided_at', sevenDaysAgo).order('decided_at', { ascending: false }),
    approver
      ? admin.from('erp_order_change_requests').select('id, request_type, status, created_at, decided_at, requested_by, employees!erp_order_change_requests_requested_by_fkey(name)').eq('status', 'pending').order('created_at')
      : Promise.resolve({ data: [], error: null }),
    admin.from('erp_order_change_requests').select('id, request_type, status, created_at, decided_at, requested_by, employees!erp_order_change_requests_requested_by_fkey(name)').eq('requested_by', empId).in('status', ['approved', 'rejected']).gte('decided_at', sevenDaysAgo).order('decided_at', { ascending: false }),
    loadApprovalCtx(admin),
    // 905: 확인한 결과 통지 (최근 30일만 남아 있다 — 저장 때 정리). 미적용이면 error → 숨김 없이 그대로
    admin.from('notification_reads').select('item_key, read_at').eq('employee_id', empId),
  ])
  const readKeys = new Set<string>()
  let readAllAt: number | null = null   // '모두 확인' 시각 — 이 시각 이전에 생긴 결과 통지는 숨김
  if (!readRes.error) for (const r of (readRes.data ?? []) as { item_key: string; read_at: string }[]) {
    if (r.item_key === '*') readAllAt = Date.parse(r.read_at)
    else readKeys.add(r.item_key)
  }
  const isRead = (key: string, at: string | null | undefined) => readKeys.has(key) || (readAllAt !== null && !!at && Date.parse(at) <= readAllAt)

  // ── 업무 요청 (2026-11-04 사용자 결정: 종류를 셋으로 나눔 — 개인 요청 · 공용 요청 · 내 요청) ──
  //  개인 요청 = 나 혼자 담당(single) / 공용 요청 = 내가 포함된 다수 담당(선착·공동) / 내 요청 = 내가 요청자
  const relatedIds = new Set<string>()
  const tagPending: { item: NotifItem; requestId: string }[] = []   // 904: 설명 앞에 대표 태그를 붙일 항목 (끝에서 한 번에 조회)
  const pushWr = (item: NotifItem, requestId: string) => { items.push(item); tagPending.push({ item, requestId }) }
  // 요청별 표시(2026-11-18 사용자 결정): 업무 요청 알림은 요약이 아니라 요청 1건당 한 줄 — 종 숫자(요청 건수)와 줄 수가 같다.
  //  같은 요청이 미확인이면서 마감 지남이면 한 줄에 표시(flags)를 함께 붙인다. sum = 확인할 것 패널(요약 유지)에서 묶을 기준(가장 급한 상태).
  //  prio = 해야 할 것 안에서의 순서(마감 지남 → 오늘 마감 → 미확인). 사이드바 패널은 칸별 최대 NOTIF_WR_PANEL_MAX 건, 넘치면 목록 링크.
  const bucketOf = new Map<string, NotifBucket>()   // 요청 id → 알림 칸 (진행 메모 · 이력 알림을 같은 칸에 넣기 위해)
  if (!inRes.error) {
    const shares = ((inRes.data ?? []) as unknown as MyShare[]).map(s => ({ status: s.status, r: one(s.request) })).filter((s): s is { status: WrAsgStatus; r: WR } => !!s.r && OPEN_STATUSES.includes(s.r.status))
    shares.forEach(s => { relatedIds.add(s.r.id); bucketOf.set(s.r.id, s.r.assign_mode === 'single' || !s.r.assign_mode ? 'personal' : 'shared') })
    for (const kind of ['personal', 'shared'] as const) {
      const mine = shares.filter(s => (s.r.assign_mode === 'single' || !s.r.assign_mode) === (kind === 'personal'))
      const label = kind === 'personal' ? '개인 요청' : '공용 요청'
      const k = kind === 'personal' ? 'p' : 's'
      // 목록 주소(확인할 것 패널 요약 줄): 받은 탭 + 개인/공용(kind) + 상태(filter)
      const href = (f: string) => `/me/requests?kind=${kind}&filter=${f}`
      const ids = new Set<string>()
      for (const s of mine) {   // 조회 조건상 내 몫이 미확인 · 수락 · 진행 중인 것만
        const r = s.r
        const isOver = new Date(r.due_at) < now
        const isToday = !isOver && kstDay(r.due_at) === today
        const isUnread = s.status === 'invited'
        if (!isOver && !isToday && !isUnread) continue
        ids.add(r.id)
        const flags = [isOver ? '마감 지남' : null, isToday ? '오늘 마감' : null, isUnread ? '미확인' : null].filter((x): x is string => !!x)
        const primary = isOver ? 'overdue' : isToday ? 'due_today' : 'unread'
        const sumLabel = `${label} ${isOver ? '마감 지남' : isToday ? '오늘 마감' : '미확인'}`
        pushWr({
          key: `wr:req:${r.id}`, bucket: kind, group: 'todo', tone: 'red', title: r.title,
          detail: `${one(r.requester)?.name ?? ''} · 마감 ${fmtDue(r.due_at)}${r.is_urgent ? ' · 긴급' : ''}`,
          href: `/me/requests/${r.id}`, count: 1, at: isOver ? r.due_at : r.created_at,
          flags, prio: isOver ? 0 : isToday ? 1 : 2, sum: { key: `wr:${primary}:${k}`, label: sumLabel, href: href(primary) },
        }, r.id)
      }
      breakdown[kind] = ids.size   // 요청 건수 (중복 없음)
    }
    // 사이드바 배지 = 종의 개인 + 공용 칸과 같은 숫자 (2026-11-09 — 오늘 마감 포함, 요청 건수)
    const wrTodo = breakdown.personal + breakdown.shared
    if (wrTodo) badges['/me/requests'] = { n: wrTodo, tone: 'red' }
  }
  if (!outRes.error) {
    const outbox = (outRes.data ?? []) as unknown as WR[]
    outbox.filter(r => OPEN_STATUSES.includes(r.status)).forEach(r => { relatedIds.add(r.id); if (!bucketOf.has(r.id)) bucketOf.set(r.id, 'mine') })
    const awaiting = outbox.filter(r => r.status === 'done_reported')
    const rejected = outbox.filter(r => r.status === 'rejected')
    breakdown.mine = awaiting.length
    for (const r of awaiting) pushWr({
      key: `wr:await:${r.id}`, bucket: 'mine', group: 'waiting', tone: 'amber', title: r.title,
      detail: `${one(r.assignee)?.name ?? '담당자 전원'}이(가) 처리 보고`, href: `/me/requests/${r.id}`, count: 1, at: r.reported_at,
      flags: ['완료 확정 대기'], sum: { key: 'wr:awaiting', label: '내 요청 완료 확정 대기', href: '/me/requests?tab=outbox&filter=reported' },
    }, r.id)
    for (const r of rejected) pushWr({
      key: `wr:rej:${r.id}`, bucket: 'mine', group: 'info', tone: 'gray', title: r.title,
      detail: r.reject_reason ? `사유: ${r.reject_reason}` : null, href: `/me/requests/${r.id}`, count: 1, at: r.rejected_at,
      flags: ['반려'], sum: { key: 'wr:rejected', label: '내 요청 반려됨', href: '/me/requests?tab=outbox&filter=rejected' },
    }, r.id)
    // 반려된 내 요청은 할 조작이 없어(다시 요청만) 알림 목록에만 둔다 — 배지 · 종 숫자는 완료 확정 대기만 (2026-11-09)
    if (!badges['/me/requests'] && awaiting.length) badges['/me/requests'] = { n: awaiting.length, tone: 'amber' }
  }
  // 관련 범위 넓힘(2026-11-09): 처리 보고 후에도 열린 요청의 메모는 받고, 내 담당이던 요청이 완료 확정 · 취소되면 알린다.
  //  반려 · 해제된 담당자는 대상 아님(내 몫이 끝남). 숫자(breakdown)에는 영향 없음 — 결과 통지로만.
  if (!relRes.error) {
    type Rel = { id: string; status: WrStatus; assign_mode: 'single' | 'first' | 'all' | null; assignees: { employee_id: string; status: WrAsgStatus }[] | null }
    for (const r of (relRes.data ?? []) as unknown as Rel[]) {
      const my = (r.assignees ?? []).find(a => a.employee_id === empId)
      if (!my || !ASG_ACTIVE.includes(my.status)) continue
      const closed = r.status === 'completed' || r.status === 'canceled'
      if (!closed && my.status !== 'done_reported') continue   // 보고 전 열린 요청은 위(받은 요청)에서 이미 담았다
      relatedIds.add(r.id)
      if (!bucketOf.has(r.id)) bucketOf.set(r.id, r.assign_mode === 'single' || !r.assign_mode ? 'personal' : 'shared')
    }
  }
  // 진행 메모 · 이력 (2026-11-04): 내가 관련된 열린 요청에서 다른 사람이 남긴 메모 · 수락 · 수정 · 담당자 추가 — 최근 7일, 최신 10건, 결과 통지로.
  if (relatedIds.size) {
    type Ev = { id: string; request_id: string; event: string; memo: string | null; created_at: string; actor: { name: string } | { name: string }[] | null; request: { title: string; is_private: boolean | null } | { title: string; is_private: boolean | null }[] | null }
    const ids = Array.from(relatedIds)
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100))
    // 확인한 메모는 빼고 최신 10건 — 숨긴 만큼 더 오래된 것이 올라오도록 넉넉히 받고, '모두 확인' 이전 것은 조회에서 뺀다
    const evSince = readAllAt !== null && readAllAt > Date.parse(sevenDaysAgo) ? new Date(readAllAt + 1).toISOString() : sevenDaysAgo
    const evs = (await Promise.all(chunks.map(c => admin.from('work_request_events')
      .select('id, request_id, event, memo, created_at, actor:employees!work_request_events_actor_id_fkey(name), request:work_requests!inner(title, is_private)')
      .in('request_id', c).neq('actor_id', empId).in('event', ['memo', 'accepted', 'edited', 'assignee_added', 'completed', 'canceled']).gte('created_at', evSince)
      .order('created_at', { ascending: false }).limit(Math.min(10 + readKeys.size, 200)))))
      .flatMap(r => (r.error ? [] : (r.data ?? [])) as unknown as Ev[])
      .filter(e => !readKeys.has(`wr:ev:${e.id}`))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10)
    const EV_LABEL: Record<string, string> = { memo: '진행 메모', accepted: '수락', edited: '요청 수정', assignee_added: '담당자 추가', completed: '완료 확정', canceled: '요청 취소' }
    for (const e of evs) {
      const req = one(e.request)
      pushWr({ key: `wr:ev:${e.id}`, bucket: bucketOf.get(e.request_id) ?? 'mine', group: 'info', tone: e.event === 'canceled' ? 'gray' : 'blue', title: `${EV_LABEL[e.event] ?? e.event} — ${one(e.actor)?.name ?? ''}`, detail: `${req?.title ?? ''}${(e.event === 'memo' || e.event === 'completed' || e.event === 'canceled') && e.memo ? `: ${e.memo}` : ''}`, href: `/me/requests/${e.request_id}`, count: 1, at: e.created_at }, e.request_id)
    }
  }

  // 업무 계열 태그(904) — 업무 요청 알림의 설명 앞에 대표 태그 "[수금 · 계산서] " (904 미적용이면 그대로)
  if (tagPending.length) {
    const labels = await firstTagLabels(admin, tagPending.map(p => p.requestId))
    for (const p of tagPending) { const l = labels.get(p.requestId); if (l) p.item.detail = p.item.detail ? `[${l}] ${p.item.detail}` : `[${l}]` }
  }

  // ── 휴가 ── 3단계 결재(204): 현재 단계의 차례가 내 결재 단계인 건만 "내 차례"로 센다
  let leaveTurn: Leave[] = []
  if (!leavePendRes.error) {
    const pend = (leavePendRes.data ?? []) as unknown as Leave[]
    const myLevel = appr.levelOf(empId)
    if (appr.ready) {
      if (myLevel && pend.length) {
        const steps = await loadSteps(admin, pend.map(l => l.id)).catch(() => new Map<string, LeaveStep[]>())
        leaveTurn = pend.filter(l => leaveActions({
          applicantId: l.employee_id, status: l.status, steps: steps.get(l.id) ?? [],
          myId: empId, myLevel, roster: appr.roster,
        }).myTurn)
      }
    } else if (approver) leaveTurn = pend
  }
  {
    const rows = leaveTurn
    if (rows.length) {
      const d = (l: Leave) => `${one(l.employees)?.name ?? ''} ${LEAVE_LABEL[l.leave_type] ?? l.leave_type} ${l.start_date.slice(5)}${l.end_date !== l.start_date ? `~${l.end_date.slice(5)}` : ''}`
      items.push({ key: 'leave:approve', group: 'todo', tone: 'red', title: `휴가 결재 내 차례 ${rows.length}건`, detail: rows.slice(0, 2).map(d).join(' · ') + (rows.length > 2 ? ` 외 ${rows.length - 2}` : ''), href: '/hr/leaves', count: rows.length, at: latest(rows.map(l => l.created_at)) })
      badges['/hr/leaves'] = { n: rows.length, tone: 'amber' }
      breakdown.other += rows.length
    }
  }
  if (!leaveMineRes.error) {
    const rows = (leaveMineRes.data ?? []) as unknown as Leave[]
    for (const l of rows.slice(0, 3)) {
      items.push({ key: `leave:decided:${l.id}`, group: 'info', tone: 'blue', title: `내 휴가 신청 ${l.status === 'approved' ? '승인됨' : '반려됨'}`, detail: `${l.start_date}${l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''} ${LEAVE_LABEL[l.leave_type] ?? l.leave_type}`, href: '/hr/attendance', count: 1, at: l.decided_at })
    }
  }
  // 승인된 휴가 취소 요청(208) — 인사·총무: 처리할 요청 / 본인: 최근 7일 반려된 요청. 208 미적용이면 조용히 건너뜀
  {
    const sel = 'id, employee_id, leave_type, start_date, end_date, cancel_requested_at, cancel_replied_at, cancel_request_reply, employees!attendance_leaves_employee_id_fkey(name)'
    type CR = { id: string; leave_type: string; start_date: string; end_date: string; cancel_requested_at: string | null; cancel_replied_at: string | null; cancel_request_reply: string | null; employees: { name: string } | { name: string }[] | null }
    const per = (l: CR) => `${l.start_date.slice(5)}${l.end_date !== l.start_date ? `~${l.end_date.slice(5)}` : ''}`
    const [pendRes, rejRes] = await Promise.all([
      isHrAdmin(me)
        ? admin.from('attendance_leaves').select(sel).eq('status', 'approved').eq('cancel_request_status', 'pending').neq('employee_id', empId).order('cancel_requested_at')
        : Promise.resolve({ data: [], error: null }),
      admin.from('attendance_leaves').select(sel).eq('employee_id', empId).eq('cancel_request_status', 'rejected').gte('cancel_replied_at', sevenDaysAgo),
    ])
    const pend = pendRes.error ? [] : ((pendRes.data ?? []) as unknown as CR[])
    if (pend.length) {
      items.push({ key: 'leave:cancel_req', group: 'todo', tone: 'red', title: `휴가 취소 요청 ${pend.length}건`, detail: pend.slice(0, 2).map(l => `${one(l.employees)?.name ?? ''} ${LEAVE_LABEL[l.leave_type] ?? l.leave_type} ${per(l)}`).join(' · ') + (pend.length > 2 ? ` 외 ${pend.length - 2}` : ''), href: '/hr/leaves', count: pend.length, at: latest(pend.map(l => l.cancel_requested_at)) })
      const prev = badges['/hr/leaves']?.n ?? 0
      badges['/hr/leaves'] = { n: prev + pend.length, tone: 'amber' }
      breakdown.other += pend.length
    }
    const rej = rejRes.error ? [] : ((rejRes.data ?? []) as unknown as CR[])
    for (const l of rej.slice(0, 3)) {
      items.push({ key: `leave:cancel_rej:${l.id}`, group: 'info', tone: 'gray', title: '휴가 취소 요청 반려됨', detail: `${per(l)} ${LEAVE_LABEL[l.leave_type] ?? l.leave_type}${l.cancel_request_reply ? ` — ${l.cancel_request_reply}` : ''}`, href: '/hr/attendance', count: 1, at: l.cancel_replied_at })
    }
  }

  // ── 주문 수정 · 취소 요청 ──
  if (approver && !ocrPendRes.error) {
    const rows = (ocrPendRes.data ?? []) as unknown as OCR[]
    if (rows.length) {
      items.push({ key: 'ocr:approve', bucket: 'order', group: 'todo', tone: 'red', title: `주문 수정 승인 요청 ${rows.length}건`, detail: rows.slice(0, 2).map(r => `${one(r.employees)?.name ?? ''} · ${r.request_type === 'cancel' ? '취소' : '수정'}`).join(' · ') + (rows.length > 2 ? ` 외 ${rows.length - 2}` : ''), href: '/orders/approvals', count: rows.length, at: latest(rows.map(r => r.created_at)) })
      badges['/orders/approvals'] = { n: rows.length, tone: 'amber' }
      breakdown.order += rows.length
    }
  }
  if (!ocrMineRes.error) {
    const rows = (ocrMineRes.data ?? []) as unknown as OCR[]
    for (const r of rows.slice(0, 3)) {
      items.push({ key: `ocr:decided:${r.id}`, bucket: 'order', group: 'info', tone: 'blue', title: `내 주문 ${r.request_type === 'cancel' ? '취소' : '수정'} 요청 ${r.status === 'approved' ? '승인됨' : '반려됨'}`, detail: null, href: '/orders/approvals', count: 1, at: r.decided_at })
    }
  }

  // ── 상담일지 주문 진행 요청 (705, 주문 트랙 2026-11-05) ── 705 미적용이면 조용히 건너뜀
  //  나에게 요청됐고 아직 전환 안 된 상담 = 할 일 / 내가 요청한 상담이 최근 7일 안에 주문으로 전환됨 = 결과 통지
  {
    const threeDaysAgo = new Date(now.getTime() - 3 * DAY).toISOString()
    const [assigned0, done, endedRes] = await Promise.all([
      admin.from('erp_consultations').select('id, bank_name, branch_name, order_requested_at, requester:employees!erp_consultations_order_requested_by_fkey(name)')
        .eq('order_assignee_id', empId).eq('status', '진행중').is('deleted_at', null).order('order_requested_at', { ascending: false }),
      admin.from('erp_consultations').select('id, bank_name, branch_name, assignee:employees!erp_consultations_order_assignee_id_fkey(name)')
        .eq('order_requested_by', empId).neq('order_assignee_id', empId).not('order_assignee_id', 'is', null).eq('status', '주문전환')
        .gte('updated_at', sevenDaysAgo).order('updated_at', { ascending: false }).limit(5),
      // 요청받은 상담을 요청자 쪽에서 종결 · 삭제함 (709, 2026-11-10) — 최근 3일, 결과 통지
      admin.from('erp_consultations').select('id, bank_name, branch_name, status, closed_at, closed_by, close_reason, deleted_at, deleted_by, delete_reason, closer:employees!erp_consultations_closed_by_fkey(name), deleter:employees!erp_consultations_deleted_by_fkey(name)')
        .eq('order_assignee_id', empId).or(`and(status.eq.종결,closed_at.gte.${threeDaysAgo}),deleted_at.gte.${threeDaysAgo}`).limit(10),
    ])
    // 709 미적용이면 deleted_at 조건 없이 다시 (기존 동작)
    const assigned = assigned0.error && /deleted_at/.test(assigned0.error.message)
      ? await admin.from('erp_consultations').select('id, bank_name, branch_name, order_requested_at, requester:employees!erp_consultations_order_requested_by_fkey(name)')
          .eq('order_assignee_id', empId).eq('status', '진행중').order('order_requested_at', { ascending: false })
      : assigned0
    if (!endedRes.error) {
      type ER = { id: string; bank_name: string | null; branch_name: string | null; closed_at: string | null; closed_by: string | null; close_reason: string | null; deleted_at: string | null; deleted_by: string | null; delete_reason: string | null; closer: { name: string } | { name: string }[] | null; deleter: { name: string } | { name: string }[] | null }
      for (const r of (endedRes.data ?? []) as unknown as ER[]) {
        const del = !!r.deleted_at
        if ((del ? r.deleted_by : r.closed_by) === empId) continue   // 내가 한 건 알리지 않음
        const who = one(del ? r.deleter : r.closer)?.name ?? ''
        const reason = del ? r.delete_reason : r.close_reason
        items.push({ key: `oreq:ended:${r.id}`, bucket: 'order', group: 'info', tone: 'gray', title: `요청받은 상담 ${del ? '삭제됨' : '종결됨'} — ${who}`, detail: `${[r.bank_name, r.branch_name].filter(Boolean).join(' ') || '상담일지'}${reason ? ` — ${reason.slice(0, 40)}` : ''}`, href: del ? '/orders/consultations?scope=mine' : `/orders/consultations/${r.id}`, count: 1, at: del ? r.deleted_at : r.closed_at })
      }
    }
    type CR = { id: string; bank_name: string | null; branch_name: string | null; order_requested_at?: string | null; requester?: { name: string } | { name: string }[] | null; assignee?: { name: string } | { name: string }[] | null }
    if (!assigned.error) {
      const rows = (assigned.data ?? []) as unknown as CR[]
      if (rows.length) {
        const where = (r: CR) => [r.bank_name, r.branch_name].filter(Boolean).join(' ') || '상담일지'
        items.push({ key: 'oreq:assigned', bucket: 'order', group: 'todo', tone: 'red', title: `주문 진행 요청 ${rows.length}건`, detail: `${one(rows[0].requester)?.name ?? ''}: ${where(rows[0])}` + (rows.length > 1 ? ` 외 ${rows.length - 1}` : ''), href: '/orders/consultations?scope=assigned', count: rows.length, at: latest(rows.map(r => r.order_requested_at)) })
        badges['/orders/consultations'] = { n: rows.length, tone: 'red' }
        breakdown.order += rows.length
      }
    }
    if (!done.error) {
      for (const r of (done.data ?? []) as unknown as CR[]) {
        items.push({ key: `oreq:done:${r.id}`, bucket: 'order', group: 'info', tone: 'blue', title: `요청한 주문 입력됨 — ${one(r.assignee)?.name ?? ''}`, detail: [r.bank_name, r.branch_name].filter(Boolean).join(' ') || null, href: `/orders/consultations/${r.id}`, count: 1, at: null })
      }
    }
  }

  // ── 완료 회신 (515, 주문 트랙 2026-11-05) ── 515 미적용이면 조용히 건너뜀
  //  내가 입력한 회신 대기 주문 = 할 일(개인) / 처리 불가로 되돌아온 내 요청 = 할 일(내 요청) / 나에게 온 회신 최근 7일 = 결과 통지
  {
    const [myOrders, recent, returned] = await Promise.all([
      admin.from('erp_orders').select('id, order_no, bank_name, branch_name, created_at')
        .eq('created_by_employee_id', empId).eq('source', 'direct').is('canceled_at', null)
        .gte('created_at', REPLY_START).order('created_at', { ascending: false }).limit(500),
      admin.from('erp_order_replies').select('order_id, result, memo, employee_id, employee_name, created_at')
        .not('order_id', 'is', null).gte('created_at', sevenDaysAgo).order('created_at', { ascending: false }).limit(300),
      admin.from('erp_consultations').select('*')
        .eq('order_requested_by', empId).is('order_assignee_id', null).eq('status', '진행중'),
    ])
    if (!recent.error) {
      const where = (r: { bank_name?: unknown; branch_name?: unknown }) => [r.bank_name, r.branch_name].filter(Boolean).join(' ') || '주문'
      // 1) 회신 대기 (내가 입력)
      const mine = (myOrders.data ?? []) as { id: string; order_no: string | null; bank_name: string | null; branch_name: string | null; created_at: string }[]
      const rmMine = await loadReplyMap(admin, mine.map(o => o.id))
      const waiting = mine.filter(o => rmMine.get(o.id)?.state === 'waiting')
      if (waiting.length) {
        items.push({ key: 'orep:wait', bucket: 'order', group: 'todo', tone: 'red', title: `완료 회신 대기 ${waiting.length}건`, detail: `${where(waiting[0])} · ${waiting[0].order_no ?? ''}` + (waiting.length > 1 ? ` 외 ${waiting.length - 1}` : ''), href: '/orders?reply=my_wait', count: waiting.length, at: latest(waiting.map(o => o.created_at)) })
        if (!badges['/orders']) badges['/orders'] = { n: waiting.length, tone: 'red' }
        breakdown.order += waiting.length
      }
      // 2) 처리 불가로 되돌아온 내 요청 (전환 전)
      if (!returned.error && returned.data?.length) {
        const rq = await loadConsultReqMap(admin, returned.data as unknown as ConsultReqRow[])
        const rows = (returned.data as { id: string; bank_name: string | null; branch_name: string | null; deleted_at?: string | null }[]).filter(c => !c.deleted_at && rq.get(c.id)?.state === 'returned')
        if (rows.length) {
          const first = rq.get(rows[0].id)
          items.push({ key: 'oreq:returned', bucket: 'order', group: 'todo', tone: 'red', title: `처리 불가 회신 ${rows.length}건 — 다시 요청 필요`, detail: `${first?.last_by ?? ''}: ${where(rows[0])}${first?.last_memo ? ` — ${first.last_memo.slice(0, 30)}` : ''}` + (rows.length > 1 ? ` 외 ${rows.length - 1}` : ''), href: rows.length === 1 ? `/orders/consultations/${rows[0].id}` : '/orders/consultations?scope=requested', count: rows.length, at: latest(rows.map(c => rq.get(c.id)?.last_at)) })
          breakdown.order += rows.length
        }
      }
      // 2-1) 주문 입력됨 (2026-11-06 A안) — 내가 요청자 · 상담자인 회신 대기 주문, 최근 7일 입력분. 회신이 오면 3)으로 바뀜
      {
        const since = Date.parse(sevenDaysAgo) > Date.parse(REPLY_START) ? sevenDaysAgo : REPLY_START
        const { data: recentOrders } = await admin.from('erp_orders')
          .select('id, order_no, bank_name, branch_name, consultation_id, created_at, staff_name')
          .eq('source', 'direct').is('canceled_at', null).neq('created_by_employee_id', empId)
          .gte('created_at', since).order('created_at', { ascending: false }).limit(500)
        const ro = (recentOrders ?? []) as { id: string; order_no: string | null; bank_name: string | null; branch_name: string | null; consultation_id: string | null; created_at: string; staff_name: string | null }[]
        const rmIn = await loadReplyMap(admin, ro.map(o => o.id))
        const entered = ro.filter(o => { const r = rmIn.get(o.id); return !!r && r.state === 'waiting' && r.recipients.includes(empId) })
        // 상담 요청 블록(oreq:done)과 겹치는 상담은 이쪽 하나만
        const covered = new Set(entered.map(o => o.consultation_id).filter(Boolean).map(id => `oreq:done:${id}`))
        for (let i = items.length - 1; i >= 0; i--) if (covered.has(items[i].key)) items.splice(i, 1)
        for (const o of entered.slice(0, 5)) {
          items.push({ key: `orep:entered:${o.id}`, bucket: 'order', group: 'info', tone: 'blue', title: `주문 입력됨 — ${o.staff_name ?? ''}`, detail: `${where(o)} · ${o.order_no ?? ''} · 완료 회신 대기`, href: `/orders/${o.id}`, count: 1, at: o.created_at })
        }
      }
      // 3) 나에게 온 회신 (요청자 · 상담자) — 주문별 최신 1건, 최근 7일
      const seen = new Set<string>()
      const reps = ((recent.data ?? []) as { order_id: string; result: ReplyResult; memo: string | null; employee_id: string | null; employee_name: string | null; created_at: string }[])
        .filter(r => r.employee_id !== empId && !seen.has(r.order_id) && (seen.add(r.order_id), true))
      if (reps.length) {
        const rm = await loadReplyMap(admin, reps.map(r => r.order_id))
        const toMe = reps.filter(r => rm.get(r.order_id)?.recipients.includes(empId)).slice(0, 5)
        if (toMe.length) {
          const { data: os } = await admin.from('erp_orders').select('id, order_no, bank_name, branch_name').in('id', toMe.map(r => r.order_id))
          const om = new Map((os ?? []).map(o => [o.id as string, o]))
          for (const r of toMe) {
            const o = om.get(r.order_id)
            items.push({ key: `orep:in:${r.order_id}:${r.created_at}`, bucket: 'order', group: 'info', tone: r.result === 'unable' ? 'red' : 'blue', title: `${r.result === 'unable' ? '처리 불가 회신' : '완료 회신'} — ${r.employee_name ?? ''}`, detail: `${o ? where(o) : ''} · ${REPLY_LABEL_LONG[r.result]}${r.memo ? ` — ${r.memo.slice(0, 30)}` : ''}`, href: `/orders/${r.order_id}`, count: 1, at: r.created_at })
          }
        }
      }
    }
  }

  // 905: 확인한 결과 통지 숨김 (해야 할 것 · 기다리는 것은 그대로)
  for (let i = items.length - 1; i >= 0; i--) if (items[i].group === 'info' && isRead(items[i].key, items[i].at)) items.splice(i, 1)
  const order: Record<string, number> = { todo: 0, waiting: 1, info: 2 }
  items.sort((a, b) => order[a.group] - order[b.group] || (a.prio ?? 9) - (b.prio ?? 9) || (b.at ?? '').localeCompare(a.at ?? ''))
  for (const i of items) if (!i.bucket) i.bucket = 'other'   // 휴가 결재 · 내 휴가 결과 등
  const count = breakdown.personal + breakdown.shared + breakdown.mine + breakdown.order + breakdown.other
  return NextResponse.json({ at: nowIso, count, breakdown, items, badges } satisfies NotifData)
}
