import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { OPEN_STATUSES, DUE_TRACKED, fmtDue, type WrStatus } from '@/lib/work-requests'
import type { NotifData, NotifItem } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

// GET /api/notifications — 로그인 직원의 "확인할 것" (저장 없음, 원본 상태에서 계산). API_OWNERS: my(전원).
//  원천: 업무 요청(받은 미확인·오늘 마감·지남 / 보낸 완료 대기·반려) · 휴가 승인 요청(승인권자) · 주문 수정 승인 요청(승인권자)
//        · 내 휴가 신청 결과 · 내 주문 수정 요청 결과 (최근 7일). 각 블록은 마이그레이션 미적용 시 조용히 건너뛴다.

const DAY = 86400_000
const kstDay = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
const latest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null
const LEAVE_LABEL: Record<string, string> = { annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)', sick: '병가', official: '공가', other: '기타' }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const now = new Date()
  const nowIso = now.toISOString()
  const empty: NotifData = { at: nowIso, count: 0, items: [], badges: {} }
  const empId = me.employeeId
  if (!empId) return NextResponse.json(empty)

  const admin = createAdminClient()
  const items: NotifItem[] = []
  const badges: NotifData['badges'] = {}
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY).toISOString()
  const today = kstDay(nowIso)
  const approver = isManagerLike(me)

  type WR = { id: string; title: string; status: WrStatus; due_at: string; created_at: string; reported_at: string | null; rejected_at: string | null; reject_reason: string | null; is_urgent: boolean; requester: { name: string } | { name: string }[] | null; assignee: { name: string } | { name: string }[] | null }
  type Leave = { id: string; employee_id: string; leave_type: string; start_date: string; end_date: string; status: string; created_at: string; decided_at: string | null; employees: { name: string } | { name: string }[] | null }
  type OCR = { id: string; request_type: string; status: string; created_at: string; decided_at: string | null; requested_by: string | null; employees: { name: string } | { name: string }[] | null }

  const wrSel = 'id, title, status, due_at, created_at, reported_at, rejected_at, reject_reason, is_urgent, requester:employees!work_requests_requester_id_fkey(name), assignee:employees!work_requests_assignee_id_fkey(name)'
  const [inRes, outRes, leavePendRes, leaveMineRes, ocrPendRes, ocrMineRes] = await Promise.all([
    admin.from('work_requests').select(wrSel).eq('assignee_id', empId).in('status', OPEN_STATUSES).order('due_at'),
    admin.from('work_requests').select(wrSel).eq('requester_id', empId).or(`status.eq.done_reported,and(status.eq.rejected,rejected_at.gte.${sevenDaysAgo})`).order('created_at', { ascending: false }),
    approver
      ? admin.from('attendance_leaves').select('id, employee_id, leave_type, start_date, end_date, status, created_at, decided_at, employees!attendance_leaves_employee_id_fkey(name)').eq('status', 'requested').neq('employee_id', empId).order('created_at')
      : Promise.resolve({ data: [], error: null }),
    admin.from('attendance_leaves').select('id, employee_id, leave_type, start_date, end_date, status, created_at, decided_at, employees!attendance_leaves_employee_id_fkey(name)').eq('employee_id', empId).in('status', ['approved', 'rejected']).gte('decided_at', sevenDaysAgo).order('decided_at', { ascending: false }),
    approver
      ? admin.from('erp_order_change_requests').select('id, request_type, status, created_at, decided_at, requested_by, employees!erp_order_change_requests_requested_by_fkey(name)').eq('status', 'pending').order('created_at')
      : Promise.resolve({ data: [], error: null }),
    admin.from('erp_order_change_requests').select('id, request_type, status, created_at, decided_at, requested_by, employees!erp_order_change_requests_requested_by_fkey(name)').eq('requested_by', empId).in('status', ['approved', 'rejected']).gte('decided_at', sevenDaysAgo).order('decided_at', { ascending: false }),
  ])

  // ── 업무 요청 ──
  if (!inRes.error) {
    const inbox = (inRes.data ?? []) as unknown as WR[]
    const tracked = inbox.filter(r => DUE_TRACKED.includes(r.status))
    const unread = inbox.filter(r => r.status === 'requested')
    const overdue = tracked.filter(r => new Date(r.due_at) < now)
    const dueToday = tracked.filter(r => kstDay(r.due_at) === today && new Date(r.due_at) >= now)
    const desc = (r: WR) => `${one(r.requester)?.name ?? ''}: ${r.title} (마감 ${fmtDue(r.due_at)})`
    if (unread.length) items.push({ key: 'wr:unread', group: 'todo', tone: 'red', title: `업무 요청 미확인 ${unread.length}건`, detail: desc(unread[0]) + (unread.length > 1 ? ` 외 ${unread.length - 1}` : ''), href: '/me/requests', count: unread.length, at: latest(unread.map(r => r.created_at)) })
    if (overdue.length) items.push({ key: 'wr:overdue', group: 'todo', tone: 'red', title: `업무 요청 마감 지남 ${overdue.length}건`, detail: desc(overdue[0]), href: '/me/requests', count: overdue.length, at: latest(overdue.map(r => r.due_at)) })
    if (dueToday.length) items.push({ key: 'wr:due_today', group: 'todo', tone: 'red', title: `업무 요청 오늘 마감 ${dueToday.length}건`, detail: desc(dueToday[0]), href: '/me/requests', count: dueToday.length, at: latest(dueToday.map(r => r.created_at)) })
    const red = unread.length + overdue.length
    if (red) badges['/me/requests'] = { n: red, tone: 'red' }
  }
  if (!outRes.error) {
    const outbox = (outRes.data ?? []) as unknown as WR[]
    const awaiting = outbox.filter(r => r.status === 'done_reported')
    const rejected = outbox.filter(r => r.status === 'rejected')
    if (awaiting.length) items.push({ key: 'wr:awaiting', group: 'waiting', tone: 'amber', title: `완료 확정 대기 ${awaiting.length}건`, detail: `${one(awaiting[0].assignee)?.name ?? ''}이(가) 처리 보고: ${awaiting[0].title}`, href: '/me/requests?tab=outbox', count: awaiting.length, at: latest(awaiting.map(r => r.reported_at)) })
    if (rejected.length) items.push({ key: 'wr:rejected', group: 'info', tone: 'gray', title: `요청 반려됨 ${rejected.length}건`, detail: `${rejected[0].title}${rejected[0].reject_reason ? ` — 사유: ${rejected[0].reject_reason}` : ''}`, href: '/me/requests?tab=outbox', count: rejected.length, at: latest(rejected.map(r => r.rejected_at)) })
    if (!badges['/me/requests'] && awaiting.length + rejected.length) badges['/me/requests'] = { n: awaiting.length + rejected.length, tone: 'amber' }
  }

  // ── 휴가 ──
  if (approver && !leavePendRes.error) {
    const rows = (leavePendRes.data ?? []) as unknown as Leave[]
    if (rows.length) {
      const d = (l: Leave) => `${one(l.employees)?.name ?? ''} ${LEAVE_LABEL[l.leave_type] ?? l.leave_type} ${l.start_date.slice(5)}${l.end_date !== l.start_date ? `~${l.end_date.slice(5)}` : ''}`
      items.push({ key: 'leave:approve', group: 'todo', tone: 'red', title: `휴가 승인 요청 ${rows.length}건`, detail: rows.slice(0, 2).map(d).join(' · ') + (rows.length > 2 ? ` 외 ${rows.length - 2}` : ''), href: '/hr/approvals', count: rows.length, at: latest(rows.map(l => l.created_at)) })
      badges['/hr/approvals'] = { n: rows.length, tone: 'amber' }
    }
  }
  if (!leaveMineRes.error) {
    const rows = (leaveMineRes.data ?? []) as unknown as Leave[]
    for (const l of rows.slice(0, 3)) {
      items.push({ key: `leave:decided:${l.id}`, group: 'info', tone: 'blue', title: `내 휴가 신청 ${l.status === 'approved' ? '승인됨' : '반려됨'}`, detail: `${l.start_date}${l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''} ${LEAVE_LABEL[l.leave_type] ?? l.leave_type}`, href: '/hr/attendance', count: 1, at: l.decided_at })
    }
  }

  // ── 주문 수정 · 취소 요청 ──
  if (approver && !ocrPendRes.error) {
    const rows = (ocrPendRes.data ?? []) as unknown as OCR[]
    if (rows.length) {
      items.push({ key: 'ocr:approve', group: 'todo', tone: 'red', title: `주문 수정 승인 요청 ${rows.length}건`, detail: rows.slice(0, 2).map(r => `${one(r.employees)?.name ?? ''} · ${r.request_type === 'cancel' ? '취소' : '수정'}`).join(' · ') + (rows.length > 2 ? ` 외 ${rows.length - 2}` : ''), href: '/orders/approvals', count: rows.length, at: latest(rows.map(r => r.created_at)) })
      badges['/orders/approvals'] = { n: rows.length, tone: 'amber' }
    }
  }
  if (!ocrMineRes.error) {
    const rows = (ocrMineRes.data ?? []) as unknown as OCR[]
    for (const r of rows.slice(0, 3)) {
      items.push({ key: `ocr:decided:${r.id}`, group: 'info', tone: 'blue', title: `내 주문 ${r.request_type === 'cancel' ? '취소' : '수정'} 요청 ${r.status === 'approved' ? '승인됨' : '반려됨'}`, detail: null, href: '/orders/approvals', count: 1, at: r.decided_at })
    }
  }

  const order: Record<string, number> = { todo: 0, waiting: 1, info: 2 }
  items.sort((a, b) => order[a.group] - order[b.group] || (b.at ?? '').localeCompare(a.at ?? ''))
  const count = items.filter(i => i.group !== 'info').reduce((s, i) => s + i.count, 0)
  return NextResponse.json({ at: nowIso, count, items, badges } satisfies NotifData)
}
