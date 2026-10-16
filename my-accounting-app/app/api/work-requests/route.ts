import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { OPEN_STATUSES, DUE_TRACKED, type WrRow } from '@/lib/work-requests'
import { ROW_SELECT, normalize, isMissing, MIGRATION_HINT, type RawRow } from '@/lib/work-requests-server'

export const dynamic = 'force-dynamic'

// 업무 요청 (900) — 내 업무 그룹(전원). 본인이 요청자 또는 담당자인 건만 다룬다.
//  GET  ?box=inbox|outbox[&closed=1]  — 받은/보낸 요청 목록 (+요약 건수)
//  GET  ?summary=1                     — 사이드바 배지·대시보드 카드용 건수만
//  POST { assignee_id, title, content?, link?, due_at, is_urgent? } — 새 요청 (요청자 = 나)

function summarize(inbox: WrRow[], outbox: WrRow[], now = new Date()) {
  const todayKst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)
  const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
  const tracked = inbox.filter(r => DUE_TRACKED.includes(r.status))
  return {
    inbox_unread: inbox.filter(r => r.status === 'requested').length,
    inbox_active: inbox.filter(r => r.status === 'accepted' || r.status === 'in_progress').length,
    inbox_due_today: tracked.filter(r => dayOf(r.due_at) === todayKst && new Date(r.due_at) >= now).length,
    inbox_overdue: tracked.filter(r => new Date(r.due_at) < now).length,
    inbox_reported: inbox.filter(r => r.status === 'done_reported').length,
    outbox_open: outbox.filter(r => OPEN_STATUSES.includes(r.status)).length,
    outbox_awaiting: outbox.filter(r => r.status === 'done_reported').length,
    outbox_rejected: outbox.filter(r => r.status === 'rejected').length,
    outbox_overdue: outbox.filter(r => DUE_TRACKED.includes(r.status) && new Date(r.due_at) < now).length,
  }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams
  const empId = me.employeeId
  if (!empId) return NextResponse.json({ linked: false, rows: [], summary: null, me: null })

  // 요약(배지)·목록 모두 열린 건은 전부, 닫힌 건은 요청 시에만 (최근 90일)
  const closedWanted = sp.get('closed') === '1'
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  const base = () => admin.from('work_requests').select(ROW_SELECT).order('is_urgent', { ascending: false }).order('due_at', { ascending: true }).limit(1000)
  const [inRes, outRes] = await Promise.all([
    closedWanted
      ? base().eq('assignee_id', empId).or(`status.in.(${OPEN_STATUSES.join(',')}),created_at.gte.${since}`)
      : base().eq('assignee_id', empId).in('status', OPEN_STATUSES),
    closedWanted
      ? base().eq('requester_id', empId).or(`status.in.(${OPEN_STATUSES.join(',')}),created_at.gte.${since}`)
      : base().eq('requester_id', empId).in('status', [...OPEN_STATUSES, 'rejected']),
  ])
  const err = inRes.error ?? outRes.error
  if (err) return NextResponse.json({ error: isMissing(err.message) ? MIGRATION_HINT : err.message }, { status: 500 })
  const inbox = ((inRes.data ?? []) as unknown as RawRow[]).map(normalize)
  const outbox = ((outRes.data ?? []) as unknown as RawRow[]).map(normalize)
  const summary = summarize(inbox.filter(r => OPEN_STATUSES.includes(r.status)), outbox.filter(r => OPEN_STATUSES.includes(r.status) || r.status === 'rejected'))

  if (sp.get('summary') === '1') return NextResponse.json({ linked: true, summary })
  const box = sp.get('box') === 'outbox' ? 'outbox' : 'inbox'
  return NextResponse.json({ linked: true, me: { id: empId, name: me.employeeName }, box, rows: box === 'inbox' ? inbox : outbox, summary })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정은 요청할 수 없습니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { assignee_id?: string; title?: string; content?: string; link?: string; due_at?: string; is_urgent?: boolean }
  const title = (body.title ?? '').trim()
  if (!body.assignee_id) return NextResponse.json({ error: '담당자를 선택하세요.' }, { status: 400 })
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
  const due = body.due_at ? new Date(body.due_at) : null
  if (!due || Number.isNaN(due.getTime())) return NextResponse.json({ error: '마감 일시를 입력하세요.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: asg, error: aErr } = await admin.from('employees').select('id, name, is_active').eq('id', body.assignee_id).maybeSingle()
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  if (!asg || !asg.is_active) return NextResponse.json({ error: '담당자를 찾을 수 없거나 비활성 직원입니다.' }, { status: 400 })

  const { data: created, error } = await admin.from('work_requests').insert({
    requester_id: me.employeeId, assignee_id: body.assignee_id, title,
    content: (body.content ?? '').trim() || null, link: (body.link ?? '').trim() || null,
    due_at: due.toISOString(), is_urgent: !!body.is_urgent,
  }).select('id').single()
  if (error) return NextResponse.json({ error: isMissing(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
  await admin.from('work_request_events').insert({ request_id: created.id, actor_id: me.employeeId, event: 'created', memo: null })
  return NextResponse.json({ ok: true, id: created.id })
}
