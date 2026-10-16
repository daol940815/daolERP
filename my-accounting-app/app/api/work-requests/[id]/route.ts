import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { recordWorkLog } from '@/lib/work-log'
import { allowedActions, type WrRow, type WrEventRow } from '@/lib/work-requests'
import { ROW_SELECT, normalize, isMissing, MIGRATION_HINT, type RawRow } from '@/lib/work-requests-server'

export const dynamic = 'force-dynamic'

// GET  /api/work-requests/[id]            — 상세 + 이력 (당사자, 또는 경영 현황 조회 권한자는 읽기만)
// POST /api/work-requests/[id] { action, memo?, title?, content?, link?, due_at?, is_urgent? }
//   accept · reject(memo=사유 필수) · memo · report  — 담당자
//   complete · cancel · edit                        — 요청자
//   본인 요청(요청자 = 담당자)은 양쪽 조작 모두 가능. 판정 규칙은 lib/work-requests allowedActions 와 동일.

type RawEvent = Omit<WrEventRow, 'actor'> & { actor: WrEventRow['actor'] | WrEventRow['actor'][] }

async function loadRow(admin: ReturnType<typeof createAdminClient>, id: string): Promise<WrRow | null> {
  const { data, error } = await admin.from('work_requests').select(ROW_SELECT).eq('id', id).maybeSingle()
  if (error) throw new Error(isMissing(error.message) ? MIGRATION_HINT : error.message)
  return data ? normalize(data as unknown as RawRow) : null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  let row: WrRow | null
  try { row = await loadRow(admin, params.id) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
  if (!row) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 })
  const meId = me.employeeId
  const party = !!meId && (row.requester?.id === meId || row.assignee?.id === meId)
  if (!party && !can(me, 'mgmt')) return NextResponse.json({ error: '이 요청의 당사자가 아닙니다.' }, { status: 403 })

  const { data: ev } = await admin.from('work_request_events')
    .select('id, event, memo, snapshot, created_at, actor:employees!work_request_events_actor_id_fkey(id, name, team)')
    .eq('request_id', params.id).order('created_at', { ascending: true })
  const events: WrEventRow[] = ((ev ?? []) as unknown as RawEvent[]).map(e => ({ ...e, actor: Array.isArray(e.actor) ? e.actor[0] ?? null : e.actor }))
  return NextResponse.json({ row, events, me: { id: meId }, actions: allowedActions(row, meId) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as {
    action?: string; memo?: string; title?: string; content?: string; link?: string; due_at?: string; is_urgent?: boolean
  }
  const admin = createAdminClient()
  let row: WrRow | null
  try { row = await loadRow(admin, params.id) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
  if (!row) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 })

  const meId = me.employeeId
  const ok = allowedActions(row, meId)
  const memo = (body.memo ?? '').trim()
  const now = new Date().toISOString()
  const deny = (m: string) => NextResponse.json({ error: m }, { status: 403 })
  const title = row.title
  const reqName = row.requester?.name ?? '요청자'

  let patch: Record<string, unknown> = {}
  let event: { event: string; memo: string | null; snapshot?: Record<string, unknown> } | null = null

  switch (body.action) {
    case 'accept':
      if (!ok.accept) return deny('수락할 수 없는 상태이거나 담당자가 아닙니다.')
      patch = { status: 'accepted', accepted_at: now }
      event = { event: 'accepted', memo: memo || null }
      break
    case 'reject':
      if (!ok.reject) return deny('반려할 수 없는 상태이거나 담당자가 아닙니다.')
      if (!memo) return NextResponse.json({ error: '반려 사유를 입력하세요.' }, { status: 400 })
      patch = { status: 'rejected', rejected_at: now, reject_reason: memo }
      event = { event: 'rejected', memo }
      break
    case 'memo':
      if (!ok.memo) return deny('메모를 남길 수 없는 상태이거나 당사자가 아닙니다.')
      if (!memo) return NextResponse.json({ error: '메모 내용을 입력하세요.' }, { status: 400 })
      patch = { last_memo: memo, last_memo_at: now }
      // 담당자의 첫 메모는 '진행 중'으로 올린다
      if (ok.isAsg && row.status === 'accepted') patch.status = 'in_progress'
      event = { event: 'memo', memo }
      break
    case 'report':
      if (!ok.report) return deny('처리 완료 보고를 할 수 없는 상태이거나 담당자가 아닙니다.')
      patch = { status: 'done_reported', reported_at: now, ...(memo ? { last_memo: memo, last_memo_at: now } : {}) }
      event = { event: 'reported', memo: memo || null }
      break
    case 'complete':
      if (!ok.complete) return deny('완료 확정은 요청자만 할 수 있습니다.')
      patch = { status: 'completed', completed_at: now }
      event = { event: 'completed', memo: memo || null }
      break
    case 'cancel':
      if (!ok.cancel) return deny('취소는 요청자만 할 수 있습니다.')
      patch = { status: 'canceled', canceled_at: now }
      event = { event: 'canceled', memo: memo || null }
      break
    case 'edit': {
      if (!ok.edit) return deny('수정은 요청자만, 처리 보고 전까지 할 수 있습니다.')
      const next: Record<string, unknown> = {}
      if (body.title !== undefined) { const t = body.title.trim(); if (!t) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 }); next.title = t }
      if (body.content !== undefined) next.content = body.content.trim() || null
      if (body.link !== undefined) next.link = body.link.trim() || null
      if (body.due_at !== undefined) { const d = new Date(body.due_at); if (Number.isNaN(d.getTime())) return NextResponse.json({ error: '마감 일시가 올바르지 않습니다.' }, { status: 400 }); next.due_at = d.toISOString() }
      if (body.is_urgent !== undefined) next.is_urgent = !!body.is_urgent
      if (!Object.keys(next).length) return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 })
      patch = next
      const changed = Object.keys(next).map(k => ({ title: '제목', content: '내용', link: '링크', due_at: '마감', is_urgent: '긴급' }[k] ?? k)).join(' · ')
      event = { event: 'edited', memo: `${changed} 수정`, snapshot: { title: row.title, content: row.content, link: row.link, due_at: row.due_at, is_urgent: row.is_urgent } }
      break
    }
    default:
      return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
  }

  const { error } = await admin.from('work_requests').update(patch).eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (event) await admin.from('work_request_events').insert({ request_id: row.id, actor_id: meId, ...event })

  // 업무일지 자동 기재 (담당자 일지) — 수락 · 완료 확정(담당자가 수락한 건만). 실패해도 본 작업은 유지.
  if (body.action === 'accept') {
    await recordWorkLog(admin, { employeeId: row.assignee?.id ?? null, action: '업무요청수락', content: `업무 요청 수락 — ${title} (요청 ${reqName})`, refType: 'work_request', refId: row.id })
  }
  if (body.action === 'complete' && row.accepted_at) {
    await recordWorkLog(admin, { employeeId: row.assignee?.id ?? null, action: '업무요청완료', content: `업무 요청 완료 — ${title} (요청 ${reqName})`, refType: 'work_request', refId: row.id })
  }
  return NextResponse.json({ ok: true })
}
