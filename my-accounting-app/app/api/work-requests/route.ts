import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { monthRange } from '@/lib/attendance'
import { OPEN_STATUSES, DUE_TRACKED, ASG_ACTIVE, ASG_TRACKED, myShare, isAssigneeOf, fmtDue, cleanTagIds, type WrRow, type WrScope, type WrMode } from '@/lib/work-requests'
import { selectRows, canSeePrivate, normalize, hintFor, loadTags, tagPrefix, type RawRow } from '@/lib/work-requests-server'
import { broadcastWrChanged } from '@/lib/realtime-broadcast'
import { sendPush } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

// 업무 요청 (900·901·902) — 내 업무 그룹(전원).
//  GET  ?scope=all|inbox|outbox[&closed=1][&month=YYYY-MM][&employee=<id>]  — 목록 (+내 요약 건수)
//       all   : 공용 목록(2026-11-02) — 지금 열린 건 전부 + 선택한 달(기본 이달)에 생성된 닫힌 건. 비공개는 당사자·승인권자만.
//       inbox : 내 몫(담당자 행)이 있는 건 — 선착에서 해제된 건은 제외 / outbox : 내가 요청자 (closed=1 이면 최근 90일 닫힌 건 포함)
//       employee=<id> : 그 직원이 요청자 또는 담당자인 건만 (경영 현황 드릴다운)
//       box=  (옛 파라미터) 도 scope 로 받는다.
//  GET  ?summary=1                     — 사이드바 배지·대시보드 카드용 건수만 (내 몫 기준)
//  POST { assignee_ids[], assign_mode?: first|all, title, content?, link?, due_at, is_urgent?, is_private?, tag_ids[] } — 새 요청 (요청자 = 나)
//       904: tag_ids(업무 계열) 1~3개 필수 — 904 미적용 환경에서는 태그 없이 받는다. 목록 응답에 태그 마스터(tags)를 함께 내려준다.
//       assignee_id(단수) 도 받는다. 담당자 2명 이상이면 assign_mode 필수.

function summarize(inbox: WrRow[], outbox: WrRow[], meId: string, now = new Date()) {
  const todayKst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)
  const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
  const open = inbox.filter(r => OPEN_STATUSES.includes(r.status))
  const mine = (r: WrRow) => myShare(r, meId)!
  const tracked = open.filter(r => ASG_TRACKED.includes(mine(r).status))
  return {
    inbox_unread: open.filter(r => mine(r).status === 'invited').length,
    inbox_active: open.filter(r => mine(r).status === 'accepted' || mine(r).status === 'in_progress').length,
    inbox_due_today: tracked.filter(r => dayOf(r.due_at) === todayKst && new Date(r.due_at) >= now).length,
    inbox_overdue: tracked.filter(r => new Date(r.due_at) < now).length,
    inbox_reported: open.filter(r => mine(r).status === 'done_reported').length,
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
  const base = (select: string) => admin.from('work_requests').select(select).order('created_at', { ascending: false }).limit(1000)  // 생성일시 내림차순(최근 요청이 위) — 2026-11-03 사용자 결정
  // 최근 90일 생성분 + 지금 열린 건 전부(회사 전체) — 여기서 내가 받은/보낸 것을 가른다 (담당자 행이 요청에 묻어오므로 1회 조회)
  const [recent, tags] = await Promise.all([
    selectRows<RawRow[]>(sel => base(sel).or(`status.in.(${OPEN_STATUSES.join(',')}),created_at.gte.${since}`)),
    sp.get('summary') === '1' ? Promise.resolve([]) : loadTags(admin),
  ])
  if (recent.error) return NextResponse.json({ error: hintFor(recent.error.message) }, { status: 500 })
  const all90 = (recent.data ?? []).map(normalize)
  // 내가 받은: 내 담당자 행이 있고 해제되지 않은 건. 기본은 내 몫이 살아 있는 것만, closed=1 이면 반려·완료된 것도.
  const inboxAll = all90.filter(r => { const m = myShare(r, empId); return !!m && m.status !== 'released' })
  const inbox = inboxAll.filter(r => closedWanted ? true : (OPEN_STATUSES.includes(r.status) && ASG_ACTIVE.includes(myShare(r, empId)!.status)))
  const outboxAll = all90.filter(r => r.requester?.id === empId)
  const outbox = outboxAll.filter(r => closedWanted ? true : (OPEN_STATUSES.includes(r.status) || r.status === 'rejected'))
  const summary = summarize(inboxAll, outboxAll.filter(r => OPEN_STATUSES.includes(r.status) || r.status === 'rejected'), empId)
  if (sp.get('summary') === '1') return NextResponse.json({ linked: true, summary })

  const scopeRaw = sp.get('scope') ?? sp.get('box') ?? 'inbox'
  const scope: WrScope = scopeRaw === 'all' || scopeRaw === 'outbox' ? scopeRaw : 'inbox'
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') ?? '') ? sp.get('month')! : kstMonth()
  const employee = sp.get('employee') || null
  const meInfo = { id: empId, name: me.employeeName, approver, master: me.isMaster }
  const related = (r: WrRow, id: string) => r.requester?.id === id || isAssigneeOf(r, id)

  if (scope !== 'all') {
    let rows = scope === 'inbox' ? inbox : outbox
    if (employee) rows = rows.filter(r => related(r, employee))
    return NextResponse.json({ linked: true, me: meInfo, scope, box: scope, month, rows, summary, tags })
  }

  // 공용 목록: 열린 건 전부 + 선택한 달에 생성된 건(닫힌 건 포함). 비공개는 볼 수 있는 사람에게만.
  const [from, to] = monthRange(month)
  const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString(), toIso = new Date(`${to}T23:59:59+09:00`).toISOString()
  const allRes = await selectRows<RawRow[]>(sel =>
    base(sel).or(`status.in.(${OPEN_STATUSES.join(',')}),and(created_at.gte.${fromIso},created_at.lte.${toIso})`))
  if (allRes.error) return NextResponse.json({ error: hintFor(allRes.error.message) }, { status: 500 })
  const everything = (allRes.data ?? []).map(normalize)
  let rows = everything.filter(r => canSeePrivate(r, empId, approver))
  const hiddenPrivate = everything.length - rows.length
  if (employee) rows = rows.filter(r => related(r, employee))
  return NextResponse.json({ linked: true, me: meInfo, scope, box: scope, month, rows, summary, hiddenPrivate, tags })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정은 요청할 수 없습니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as {
    assignee_id?: string; assignee_ids?: string[]; assign_mode?: string
    title?: string; content?: string; link?: string; due_at?: string; is_urgent?: boolean; is_private?: boolean; tag_ids?: string[]
  }
  const title = (body.title ?? '').trim()
  const ids = Array.from(new Set([...(Array.isArray(body.assignee_ids) ? body.assignee_ids : []), ...(body.assignee_id ? [body.assignee_id] : [])].filter(x => typeof x === 'string' && x)))
  if (!ids.length) return NextResponse.json({ error: '담당자를 선택하세요.' }, { status: 400 })
  if (ids.length > 50) return NextResponse.json({ error: '담당자는 50명까지 지정할 수 있습니다.' }, { status: 400 })
  let mode: WrMode = 'single'
  if (ids.length > 1) {
    if (body.assign_mode !== 'first' && body.assign_mode !== 'all') return NextResponse.json({ error: '담당자가 2명 이상이면 진행 방식(선착 · 공동)을 선택하세요.' }, { status: 400 })
    mode = body.assign_mode
  }
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
  const due = body.due_at ? new Date(body.due_at) : null
  if (!due || Number.isNaN(due.getTime())) return NextResponse.json({ error: '마감 일시를 입력하세요.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: emps, error: aErr } = await admin.from('employees').select('id, name, is_active').in('id', ids)
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  const active = (emps ?? []).filter(e => e.is_active)
  if (active.length !== ids.length) return NextResponse.json({ error: '담당자 중 찾을 수 없거나 비활성인 직원이 있습니다.' }, { status: 400 })
  // 업무 계열 태그(904) — 사용 중인 태그 중 1~3개. 태그 마스터가 없으면(904 미적용) 태그 없이 만든다.
  const tags = await loadTags(admin)
  let tagIds: string[] = []
  if (tags.some(t => t.active)) {
    const c = cleanTagIds(body.tag_ids, new Set(tags.filter(t => t.active).map(t => t.id)))
    if (c.error) return NextResponse.json({ error: c.error }, { status: 400 })
    tagIds = c.ids
  }

  const row: Record<string, unknown> = {
    requester_id: me.employeeId, assignee_id: ids.length === 1 ? ids[0] : null, assign_mode: mode, title,
    content: (body.content ?? '').trim() || null, link: (body.link ?? '').trim() || null,
    due_at: due.toISOString(), is_urgent: !!body.is_urgent, is_private: !!body.is_private,
  }
  const r = await admin.from('work_requests').insert(row).select('id').single()
  if (r.error) return NextResponse.json({ error: hintFor(r.error.message) }, { status: 500 })
  const { error: asgErr } = await admin.from('work_request_assignees').insert(ids.map(id => ({ request_id: r.data.id, employee_id: id, status: 'invited' })))
  if (asgErr) {
    await admin.from('work_requests').delete().eq('id', r.data.id)   // 담당자 행이 없으면 요청도 남기지 않는다
    return NextResponse.json({ error: hintFor(asgErr.message) }, { status: 500 })
  }
  if (tagIds.length) {
    const { error: tagErr } = await admin.from('work_request_tag_links').insert(tagIds.map(tag_id => ({ request_id: r.data.id, tag_id })))
    if (tagErr) {
      await admin.from('work_requests').delete().eq('id', r.data.id)   // 태그 없이 남기지 않는다 (담당자 행은 연쇄 삭제)
      return NextResponse.json({ error: hintFor(tagErr.message) }, { status: 500 })
    }
  }
  await admin.from('work_request_events').insert({
    request_id: r.data.id, actor_id: me.employeeId, event: 'created',
    memo: ids.length > 1 ? `담당자 ${ids.length}명 · ${mode === 'first' ? '선착' : '공동'} 방식` : null,
  })
  await broadcastWrChanged(r.data.id, [me.employeeId, ...ids])
  // PC 알림(⑦) — 담당자(본인 제외)에게 "새 업무 요청". 비공개는 제목 없이.
  await sendPush(admin, ids.filter(id => id !== me.employeeId), body.is_private
    ? { kind: 'wr_new', title: '비공개 업무 요청 1건', body: `마감 ${fmtDue(due.toISOString())} · 상세는 ERP에서 확인`, url: `/me/requests/${r.data.id}`, tag: `wr:${r.data.id}` }
    : { kind: 'wr_new', title: `새 업무 요청 — ${me.employeeName ?? '요청자'}`, body: `${tagPrefix(tagIds, tags)}${title} · 마감 ${fmtDue(due.toISOString())}${body.is_urgent ? ' · 긴급' : ''}${mode === 'first' ? ' · 선착' : mode === 'all' ? ' · 공동' : ''}`, url: `/me/requests/${r.data.id}`, tag: `wr:${r.data.id}` })
  return NextResponse.json({ ok: true, id: r.data.id })
}
