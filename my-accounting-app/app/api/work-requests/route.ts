import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { monthRange } from '@/lib/attendance'
import { OPEN_STATUSES, DUE_TRACKED, type WrRow, type WrScope } from '@/lib/work-requests'
import { selectWithPrivacy, canSeePrivate, normalize, isMissing, MIGRATION_HINT, type RawRow } from '@/lib/work-requests-server'

export const dynamic = 'force-dynamic'

// 업무 요청 (900·901) — 내 업무 그룹(전원).
//  GET  ?scope=all|inbox|outbox[&closed=1][&month=YYYY-MM][&employee=<id>]  — 목록 (+내 요약 건수)
//       all   : 공용 목록(2026-11-02) — 지금 열린 건 전부 + 선택한 달(기본 이달)에 생성된 닫힌 건. 비공개는 당사자·승인권자만.
//       inbox : 내가 담당자 / outbox : 내가 요청자 (closed=1 이면 최근 90일 닫힌 건 포함)
//       employee=<id> : 그 직원이 요청자 또는 담당자인 건만 (경영 현황 드릴다운)
//       box=  (옛 파라미터) 도 scope 로 받는다.
//  GET  ?summary=1                     — 사이드바 배지·대시보드 카드용 건수만
//  POST { assignee_id, title, content?, link?, due_at, is_urgent?, is_private? } — 새 요청 (요청자 = 나)

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

const kstMonth = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d).slice(0, 7)

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams
  const empId = me.employeeId
  if (!empId) return NextResponse.json({ linked: false, rows: [], summary: null, me: null })
  const approver = isManagerLike(me)

  const closedWanted = sp.get('closed') === '1'
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  const base = (select: string) => admin.from('work_requests').select(select).order('is_urgent', { ascending: false }).order('due_at', { ascending: true }).limit(1000)
  const [inRes, outRes] = await Promise.all([
    selectWithPrivacy<RawRow[]>(sel => closedWanted
      ? base(sel).eq('assignee_id', empId).or(`status.in.(${OPEN_STATUSES.join(',')}),created_at.gte.${since}`)
      : base(sel).eq('assignee_id', empId).in('status', OPEN_STATUSES)),
    selectWithPrivacy<RawRow[]>(sel => closedWanted
      ? base(sel).eq('requester_id', empId).or(`status.in.(${OPEN_STATUSES.join(',')}),created_at.gte.${since}`)
      : base(sel).eq('requester_id', empId).in('status', [...OPEN_STATUSES, 'rejected'])),
  ])
  const err = inRes.error ?? outRes.error
  if (err) return NextResponse.json({ error: isMissing(err.message) ? MIGRATION_HINT : err.message }, { status: 500 })
  const inbox = (inRes.data ?? []).map(normalize)
  const outbox = (outRes.data ?? []).map(normalize)
  const summary = summarize(inbox.filter(r => OPEN_STATUSES.includes(r.status)), outbox.filter(r => OPEN_STATUSES.includes(r.status) || r.status === 'rejected'))
  if (sp.get('summary') === '1') return NextResponse.json({ linked: true, summary })

  const scopeRaw = sp.get('scope') ?? sp.get('box') ?? 'inbox'
  const scope: WrScope = scopeRaw === 'all' || scopeRaw === 'outbox' ? scopeRaw : 'inbox'
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') ?? '') ? sp.get('month')! : kstMonth()
  const employee = sp.get('employee') || null
  const meInfo = { id: empId, name: me.employeeName, approver }

  if (scope !== 'all') {
    let rows = scope === 'inbox' ? inbox : outbox
    if (employee) rows = rows.filter(r => r.requester?.id === employee || r.assignee?.id === employee)
    return NextResponse.json({ linked: true, me: meInfo, scope, box: scope, month, rows, summary, privacyReady: inRes.privacyReady })
  }

  // 공용 목록: 열린 건 전부 + 선택한 달에 생성된 건(닫힌 건 포함). 비공개는 볼 수 있는 사람에게만.
  const [from, to] = monthRange(month)
  const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString(), toIso = new Date(`${to}T23:59:59+09:00`).toISOString()
  const allRes = await selectWithPrivacy<RawRow[]>(sel =>
    base(sel).or(`status.in.(${OPEN_STATUSES.join(',')}),and(created_at.gte.${fromIso},created_at.lte.${toIso})`))
  if (allRes.error) return NextResponse.json({ error: isMissing(allRes.error.message) ? MIGRATION_HINT : allRes.error.message }, { status: 500 })
  let rows = (allRes.data ?? []).map(normalize).filter(r => canSeePrivate(r, empId, approver))
  if (employee) rows = rows.filter(r => r.requester?.id === employee || r.assignee?.id === employee)
  const hiddenPrivate = (allRes.data ?? []).length - (allRes.data ?? []).map(normalize).filter(r => canSeePrivate(r, empId, approver)).length
  return NextResponse.json({ linked: true, me: meInfo, scope, box: scope, month, rows, summary, privacyReady: allRes.privacyReady, hiddenPrivate })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정은 요청할 수 없습니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { assignee_id?: string; title?: string; content?: string; link?: string; due_at?: string; is_urgent?: boolean; is_private?: boolean }
  const title = (body.title ?? '').trim()
  if (!body.assignee_id) return NextResponse.json({ error: '담당자를 선택하세요.' }, { status: 400 })
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
  const due = body.due_at ? new Date(body.due_at) : null
  if (!due || Number.isNaN(due.getTime())) return NextResponse.json({ error: '마감 일시를 입력하세요.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: asg, error: aErr } = await admin.from('employees').select('id, name, is_active').eq('id', body.assignee_id).maybeSingle()
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  if (!asg || !asg.is_active) return NextResponse.json({ error: '담당자를 찾을 수 없거나 비활성 직원입니다.' }, { status: 400 })

  const row: Record<string, unknown> = {
    requester_id: me.employeeId, assignee_id: body.assignee_id, title,
    content: (body.content ?? '').trim() || null, link: (body.link ?? '').trim() || null,
    due_at: due.toISOString(), is_urgent: !!body.is_urgent,
  }
  let created: { id: string } | null = null
  let privacySaved = true
  if (body.is_private) {
    // 901 미적용이면 is_private 없이 저장하고 알려준다 (비공개가 저장되지 않음)
    const r1 = await admin.from('work_requests').insert({ ...row, is_private: true }).select('id').single()
    if (r1.error && /is_private/i.test(r1.error.message)) {
      privacySaved = false
      const r2 = await admin.from('work_requests').insert(row).select('id').single()
      if (r2.error) return NextResponse.json({ error: isMissing(r2.error.message) ? MIGRATION_HINT : r2.error.message }, { status: 500 })
      created = r2.data
    } else if (r1.error) {
      return NextResponse.json({ error: isMissing(r1.error.message) ? MIGRATION_HINT : r1.error.message }, { status: 500 })
    } else created = r1.data
  } else {
    const r = await admin.from('work_requests').insert(row).select('id').single()
    if (r.error) return NextResponse.json({ error: isMissing(r.error.message) ? MIGRATION_HINT : r.error.message }, { status: 500 })
    created = r.data
  }
  await admin.from('work_request_events').insert({ request_id: created!.id, actor_id: me.employeeId, event: 'created', memo: null })
  return NextResponse.json({ ok: true, id: created!.id, warning: privacySaved ? null : '비공개 설정은 901 마이그레이션 적용 후부터 저장됩니다. 이 요청은 공개로 저장되었습니다.' })
}
