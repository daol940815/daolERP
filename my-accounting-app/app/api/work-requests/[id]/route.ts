import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { recordWorkLog } from '@/lib/work-log'
import { allowedActions, myShare, fmtDue, cleanTagIds, type WrRow, type WrEventRow } from '@/lib/work-requests'
import { selectRows, canSeePrivate, normalize, hintFor, applyAggregate, loadTags, tagPrefix, replaceTagLinks, MIGRATION_HINT_904, type RawRow } from '@/lib/work-requests-server'
import { broadcastWrChanged } from '@/lib/realtime-broadcast'
import { sendPush } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

// GET  /api/work-requests/[id]            — 상세 + 이력. 공개 요청은 전원 조회(2026-11-02 공용 전환), 비공개는 당사자·승인권자만.
// POST /api/work-requests/[id] { action, memo?, title?, content?, link?, due_at?, is_urgent?, employee_ids? }
//   accept · reject(memo=사유 필수) · memo · report  — 담당자(내 몫 = 내 담당자 행)
//   complete · cancel · edit · add_assignee(employee_ids) — 요청자
//   set_tags(tag_ids) — 요청자 · 살아 있는 담당자 · 마스터 계정. 닫힌 요청도 가능. 이력만 남기고 알림은 보내지 않는다 (904, 2026-11-10)
//   902: 담당자별 상태를 바꾼 뒤 요청 전체 상태는 집계(applyAggregate)로 다시 쓴다.
//   선착(first) 수락은 요청이 아직 requested 인 경우만 통과(동시 클릭은 먼저 처리된 쪽만) → 나머지 담당자 released.
//   본인 요청(요청자 = 담당자)은 양쪽 조작 모두 가능. 판정 규칙은 lib/work-requests allowedActions 와 동일.

type RawEvent = Omit<WrEventRow, 'actor'> & { actor: WrEventRow['actor'] | WrEventRow['actor'][] }

async function loadRow(admin: ReturnType<typeof createAdminClient>, id: string): Promise<WrRow | null> {
  const { data, error } = await selectRows<RawRow>(sel => admin.from('work_requests').select(sel).eq('id', id).maybeSingle())
  if (error) throw new Error(hintFor(error.message))
  return data ? normalize(data) : null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  let row: WrRow | null
  try { row = await loadRow(admin, params.id) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
  if (!row) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 })
  const meId = me.employeeId
  if (!canSeePrivate(row, meId, isManagerLike(me))) return NextResponse.json({ error: '비공개 요청입니다. 요청자 · 담당자 · 승인권자만 볼 수 있습니다.' }, { status: 403 })

  const { data: ev } = await admin.from('work_request_events')
    .select('id, event, memo, snapshot, created_at, actor:employees!work_request_events_actor_id_fkey(id, name, team)')
    .eq('request_id', params.id).order('created_at', { ascending: true })
  const events: WrEventRow[] = ((ev ?? []) as unknown as RawEvent[]).map(e => ({ ...e, actor: Array.isArray(e.actor) ? e.actor[0] ?? null : e.actor }))
  const actions = allowedActions(row, meId)
  const tags = await loadTags(admin)
  return NextResponse.json({ row, events, me: { id: meId }, actions: { ...actions, setTags: tags.length > 0 && (actions.setTags || me.isMaster) }, tags })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as {
    action?: string; memo?: string; title?: string; content?: string; link?: string; due_at?: string; is_urgent?: boolean; employee_ids?: string[]; tag_ids?: string[]
  }
  const admin = createAdminClient()
  let row: WrRow | null
  try { row = await loadRow(admin, params.id) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
  if (!row) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 })

  const meId = me.employeeId
  const ok = allowedActions(row, meId)
  const my = myShare(row, meId)
  const memo = (body.memo ?? '').trim()
  const now = new Date().toISOString()
  const deny = (m: string) => NextResponse.json({ error: m }, { status: 403 })
  const bad = (m: string) => NextResponse.json({ error: m }, { status: 400 })
  const title = row.title
  const reqName = row.requester?.name ?? '요청자'
  const multi = row.assignees.length > 1
  const myName = me.employeeName ?? '담당자'
  const patchMine = async (patch: Record<string, unknown>) => {
    const { error } = await admin.from('work_request_assignees').update(patch).eq('id', my!.id)
    if (error) throw new Error(error.message)
  }

  let reqPatch: Record<string, unknown> = {}
  let event: { event: string; memo: string | null; snapshot?: Record<string, unknown> } | null = null
  let aggregate = false
  const notify = new Set<string>([row.requester?.id ?? '', ...row.assignees.map(a => a.employee?.id ?? '')])

  try {
    switch (body.action) {
      case 'accept': {
        if (!ok.accept) return deny('수락할 수 없는 상태이거나 담당자가 아닙니다.')
        if (row.assign_mode === 'first') {
          // 선착: 아직 requested 인 요청만 수락자로 기록 (동시 클릭 방지 — 먼저 처리된 쪽만 통과)
          const { data: won, error } = await admin.from('work_requests').update({ status: 'accepted', assignee_id: meId, accepted_at: now }).eq('id', row.id).eq('status', 'requested').select('id')
          if (error) throw new Error(error.message)
          if (!won?.length) return NextResponse.json({ error: '이미 다른 사람이 수락했습니다.' }, { status: 409 })
          await patchMine({ status: 'accepted', accepted_at: now })
          const others = row.assignees.filter(a => a.id !== my!.id && a.status === 'invited')
          if (others.length) {
            const { error: relErr } = await admin.from('work_request_assignees').update({ status: 'released' }).in('id', others.map(a => a.id))
            if (relErr) throw new Error(relErr.message)
          }
          event = { event: 'accepted', memo: [memo || null, others.length ? `나머지 ${others.length}명 자동 해제` : null].filter(Boolean).join(' — ') || null }
        } else {
          await patchMine({ status: 'accepted', accepted_at: now })
          event = { event: 'accepted', memo: memo || null }
        }
        aggregate = true
        break
      }
      case 'reject':
        if (!ok.reject) return deny('반려할 수 없는 상태이거나 담당자가 아닙니다.')
        if (!memo) return bad('반려 사유를 입력하세요.')
        await patchMine({ status: 'rejected', rejected_at: now, reject_reason: memo })
        event = { event: 'rejected', memo }
        aggregate = true
        break
      case 'memo':
        if (!ok.memo) return deny('메모를 남길 수 없는 상태이거나 당사자가 아닙니다.')
        if (!memo) return bad('메모 내용을 입력하세요.')
        if (ok.isAsg) {
          // 담당자의 첫 메모는 내 몫을 '진행 중'으로 올린다
          await patchMine({ last_memo: memo, last_memo_at: now, ...(my!.status === 'accepted' ? { status: 'in_progress' } : {}) })
          aggregate = true
        }
        reqPatch = { last_memo: multi && ok.isAsg ? `${myName}: ${memo}` : memo, last_memo_at: now }
        event = { event: 'memo', memo }
        break
      case 'report':
        if (!ok.report) return deny('처리 완료 보고를 할 수 없는 상태이거나 담당자가 아닙니다.')
        await patchMine({ status: 'done_reported', reported_at: now, ...(memo ? { last_memo: memo, last_memo_at: now } : {}) })
        if (memo) reqPatch = { last_memo: multi ? `${myName}: ${memo}` : memo, last_memo_at: now }
        event = { event: 'reported', memo: memo || null }
        aggregate = true
        break
      case 'complete':
        if (!ok.complete) return deny('완료 확정은 요청자만 할 수 있습니다.')
        reqPatch = { status: 'completed', completed_at: now }
        event = { event: 'completed', memo: memo || null }
        break
      case 'cancel':
        if (!ok.cancel) return deny('취소는 요청자만 할 수 있습니다.')
        reqPatch = { status: 'canceled', canceled_at: now }
        event = { event: 'canceled', memo: memo || null }
        break
      case 'edit': {
        if (!ok.edit) return deny('수정은 요청자만, 처리 보고 전까지 할 수 있습니다.')
        const next: Record<string, unknown> = {}
        if (body.title !== undefined) { const t = body.title.trim(); if (!t) return bad('제목을 입력하세요.'); next.title = t }
        if (body.content !== undefined) next.content = body.content.trim() || null
        if (body.link !== undefined) next.link = body.link.trim() || null
        if (body.due_at !== undefined) { const d = new Date(body.due_at); if (Number.isNaN(d.getTime())) return bad('마감 일시가 올바르지 않습니다.'); next.due_at = d.toISOString() }
        if (body.is_urgent !== undefined) next.is_urgent = !!body.is_urgent
        if (!Object.keys(next).length) return bad('변경할 항목이 없습니다.')
        reqPatch = next
        const changed = Object.keys(next).map(k => ({ title: '제목', content: '내용', link: '링크', due_at: '마감', is_urgent: '긴급' }[k] ?? k)).join(' · ')
        event = { event: 'edited', memo: `${changed} 수정`, snapshot: { title: row.title, content: row.content, link: row.link, due_at: row.due_at, is_urgent: row.is_urgent } }
        break
      }
      case 'add_assignee': {
        if (!ok.addAssignee) return deny(row.assign_mode === 'first' ? '선착 방식에는 담당자를 추가할 수 없습니다.' : '담당자 추가는 요청자만, 열린 요청에만 할 수 있습니다.')
        const ids = Array.from(new Set((Array.isArray(body.employee_ids) ? body.employee_ids : []).filter(x => typeof x === 'string' && x)))
        if (!ids.length) return bad('추가할 직원을 선택하세요.')
        const { data: emps, error: eErr } = await admin.from('employees').select('id, name, is_active').in('id', ids)
        if (eErr) throw new Error(eErr.message)
        const valid = (emps ?? []).filter(e => e.is_active)
        if (valid.length !== ids.length) return bad('추가할 직원 중 찾을 수 없거나 비활성인 직원이 있습니다.')
        const byEmp = new Map(row.assignees.map(a => [a.employee?.id, a]))
        const fresh = ids.filter(id => !byEmp.has(id))
        const revive = ids.map(id => byEmp.get(id)).filter((a): a is NonNullable<typeof a> => !!a && (a.status === 'rejected' || a.status === 'released'))
        if (!fresh.length && !revive.length) return bad('이미 담당자인 직원입니다.')
        if (fresh.length) {
          const { error } = await admin.from('work_request_assignees').insert(fresh.map(id => ({ request_id: row!.id, employee_id: id, status: 'invited' })))
          if (error) throw new Error(error.message)
        }
        if (revive.length) {
          const { error } = await admin.from('work_request_assignees').update({ status: 'invited', accepted_at: null, reported_at: null, rejected_at: null, reject_reason: null }).in('id', revive.map(a => a.id))
          if (error) throw new Error(error.message)
        }
        // 단일 요청에 사람을 더하면 공동 방식이 된다
        if (row.assign_mode === 'single') reqPatch = { assign_mode: 'all', assignee_id: null }
        const names = valid.filter(e => fresh.includes(e.id) || revive.some(a => a.employee?.id === e.id)).map(e => e.name)
        event = { event: 'assignee_added', memo: `${names.join(' · ')} 추가${memo ? ` — ${memo}` : ''}` }
        ids.forEach(id => notify.add(id))
        aggregate = true
        break
      }
      case 'set_tags': {
        if (!(ok.setTags || me.isMaster)) return deny('태그 수정은 요청자 · 담당자 · 마스터 계정만 할 수 있습니다.')
        const tags = await loadTags(admin)
        if (!tags.length) return bad(MIGRATION_HINT_904)
        // 사용 중인 태그 + 이미 붙어 있던 태그(숨김 처리된 것 포함)만 고를 수 있다
        const c = cleanTagIds(body.tag_ids, new Set([...tags.filter(t => t.active).map(t => t.id), ...row.tag_ids]))
        if (c.error) return bad(c.error)
        if (c.ids.length === row.tag_ids.length && c.ids.every(id => row.tag_ids.includes(id))) return NextResponse.json({ ok: true })
        const linkErr = await replaceTagLinks(admin, row.id, row.tag_ids, c.ids)
        if (linkErr) throw new Error(hintFor(linkErr))
        const names = (ids: string[]) => tags.filter(t => ids.includes(t.id)).map(t => t.label).join(', ') || '미분류'
        event = { event: 'tags_changed', memo: `${names(row.tag_ids)} → ${names(c.ids)}` }
        break
      }
      default:
        return bad('알 수 없는 action')
    }

    if (Object.keys(reqPatch).length) {
      const { error } = await admin.from('work_requests').update(reqPatch).eq('id', row.id)
      if (error) throw new Error(error.message)
    }
    if (aggregate) await applyAggregate(admin, { ...row, ...(reqPatch as Partial<WrRow>) }, now)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  if (event) await admin.from('work_request_events').insert({ request_id: row.id, actor_id: meId, ...event })

  // 업무일지 자동 기재 (담당자 일지) — 수락: 수락한 사람 · 완료 확정: 수락했던 담당자 전원(공동은 각자). 실패해도 본 작업은 유지.
  if (body.action === 'accept') {
    await recordWorkLog(admin, { employeeId: meId, action: '업무요청수락', content: `업무 요청 수락 — ${title} (요청 ${reqName})`, refType: 'work_request', refId: row.id })
  }
  if (body.action === 'complete') {
    const done = row.assignees.filter(a => a.accepted_at && (a.status === 'accepted' || a.status === 'in_progress' || a.status === 'done_reported'))
    for (const a of done) {
      await recordWorkLog(admin, { employeeId: a.employee?.id ?? null, action: '업무요청완료', content: `업무 요청 완료 — ${title} (요청 ${reqName})`, refType: 'work_request', refId: row.id })
    }
  }
  await broadcastWrChanged(row.id, Array.from(notify))

  // PC 알림(⑦) — 반려·처리 보고는 요청자에게, 담당자 추가는 추가된 사람에게, 완료 확정·취소는 담당자에게. 본인에게는 보내지 않는다. 비공개는 제목 없이.
  if (body.action === 'set_tags') return NextResponse.json({ ok: true })   // 분류 변경은 알리지 않는다
  const tagPre = row.is_private || !row.tag_ids.length ? '' : tagPrefix(row.tag_ids, await loadTags(admin))
  const safeTitle = row.is_private ? '비공개 업무 요청' : `${tagPre}${title}`
  const url = `/me/requests/${row.id}`, tag = `wr:${row.id}`
  const reqId = row.requester?.id && row.requester.id !== meId ? row.requester.id : null
  if (body.action === 'reject' && reqId) {
    await sendPush(admin, [reqId], { kind: 'wr_result', title: `반려 — ${myName}`, body: `${safeTitle} · 사유: ${memo}`, url, tag })
  } else if (body.action === 'report' && reqId) {
    const active = row.assignees.filter(a => a.status !== 'rejected' && a.status !== 'released')
    const reported = active.filter(a => a.status === 'done_reported').length + 1
    const partial = row.assign_mode === 'all' && reported < active.length
    await sendPush(admin, [reqId], { kind: 'wr_result', title: `처리 보고 — ${myName}`, body: `${safeTitle} · ${partial ? `${reported}/${active.length} 보고` : '완료 확정을 기다립니다'}`, url, tag })
  } else if (body.action === 'memo') {
    // 진행 메모(2026-11-04, 2026-11-09 통일): 작성자를 뺀 관련자 전원 — 요청자 + 살아 있는 담당자(반려 · 해제 제외).
    //  단일 · 선착(수락 후)은 상대가 1명이라 이전과 같고, 공동은 다른 공동 담당자에게도 간다.
    const targets = Array.from(new Set([row.requester?.id, ...row.assignees.filter(a => a.status !== 'rejected' && a.status !== 'released').map(a => a.employee?.id)]
      .filter((id): id is string => !!id && id !== meId)))
    await sendPush(admin, targets, { kind: 'wr_memo', title: `진행 메모 — ${myName}`, body: `${safeTitle}: ${memo.slice(0, 80)}`, url, tag })
  } else if (body.action === 'complete' || body.action === 'cancel') {
    // 완료 확정 · 취소(2026-11-09): 내 몫이 살아 있던 담당자 전원에게 (반려 · 해제된 사람, 본인 제외)
    const targets = row.assignees.filter(a => a.status !== 'rejected' && a.status !== 'released').map(a => a.employee?.id).filter((id): id is string => !!id && id !== meId)
    const label = body.action === 'complete' ? '완료 확정' : '요청 취소'
    await sendPush(admin, targets, { kind: 'wr_closed', title: `${label} — ${myName}`, body: `${safeTitle}${memo && !row.is_private ? `: ${memo.slice(0, 80)}` : ''}`, url, tag })
  } else if (body.action === 'add_assignee') {
    const added = Array.from(notify).filter(id => id !== meId && !row.assignees.some(a => a.employee?.id === id && a.status !== 'rejected' && a.status !== 'released'))
    await sendPush(admin, added, row.is_private
      ? { kind: 'wr_new', title: '비공개 업무 요청 1건', body: `마감 ${fmtDue(row.due_at)} · 상세는 ERP에서 확인`, url, tag }
      : { kind: 'wr_new', title: `새 업무 요청 — ${reqName}`, body: `${tagPre}${title} · 마감 ${fmtDue(row.due_at)}${row.is_urgent ? ' · 긴급' : ''} · 공동`, url, tag })
  }
  return NextResponse.json({ ok: true })
}
