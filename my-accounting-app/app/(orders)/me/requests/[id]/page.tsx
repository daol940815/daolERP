'use client'

// 업무 요청 상세 — 상태 흐름 · 내용 · 담당자별 진행(902) · 이력(메모) · 역할별 조작. 조작 가능 여부는 API가 내려준 actions 로 판정(서버와 동일 규칙).
// 선착: 수락한 1명만 담당자로 남고 나머지는 "다른 사람이 수락"으로 참고 표시. 공동: 담당자마다 상태가 따로 있고 요청 상태는 그 집계.
// 요청자는 담당자를 추가할 수 있다(선착 제외 — 2026-11-02 결정 ③). 공동은 전원 보고 전에도 완료 확정 가능(결정 ②).

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  WR_STATUS_LABEL, WR_STATUS_CLS, WR_STATUS_HINT, WR_EVENT_LABEL, WR_MODE_LABEL, WR_MODE_DESC, WR_ASG_LABEL, WR_ASG_CLS, OPEN_STATUSES, ASG_ACTIVE,
  dueState, fmtDTFull, fmtDT, isoToLocal, localToIso, activeAssignees, tagsOf, WR_TAG_MAX,
  type WrRow, type WrEventRow, type WrStatus, type WrActions, type WrAssignee, type WrTag,
} from '@/lib/work-requests'
import { TagChip, TagPicker } from '@/components/work-requests/tag-chip'
import { useNotifRefresh, requestNotifRefresh } from '@/lib/use-notif-refresh'
import AttachmentBox from '@/components/attachments/AttachmentBox'

interface Detail { row: WrRow; events: WrEventRow[]; me: { id: string | null }; actions: WrActions; tags?: WrTag[] }
interface Emp { id: string; name: string; team: string | null; position: string | null; employment_type: string }
const FLOW: WrStatus[] = ['requested', 'accepted', 'in_progress', 'done_reported', 'completed']
const FLOW_LABEL: Record<string, string> = { requested: '요청', accepted: '수락', in_progress: '진행 중', done_reported: '완료 확정 대기', completed: '완료' }

export default function WorkRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [emps, setEmps] = useState<Emp[]>([])
  const [addIds, setAddIds] = useState<string[]>([])
  const [tagEdit, setTagEdit] = useState<string[] | null>(null)   // 태그 수정 중인 선택 (null = 닫힘) — 904
  const [form, setForm] = useState({ title: '', content: '', link: '', due: '', urgent: false })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    const res = await fetch(`/api/work-requests/${id}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? '조회 실패'); return }
    setD(json)
    setForm({ title: json.row.title, content: json.row.content ?? '', link: json.row.link ?? '', due: isoToLocal(json.row.due_at), urgent: json.row.is_urgent })
  }, [id])
  useEffect(() => { load() }, [load])
  useNotifRefresh(() => { if (!editing && !adding && tagEdit === null) load() })   // 상대가 수락·메모·보고하면 자동 갱신 (수정·추가 입력 중에는 보호)
  useEffect(() => { if (adding && !emps.length) fetch('/api/work-requests/employees').then(r => r.json()).then(j => setEmps(j.data ?? [])).catch(() => null) }, [adding, emps.length])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    const res = await fetch(`/api/work-requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '처리 실패'); await load(); return false }
    await load(); requestNotifRefresh()
    return true
  }

  const r = d?.row
  const addCandidates = useMemo(() => {
    if (!r) return []
    const present = new Set(r.assignees.filter(a => a.status !== 'rejected' && a.status !== 'released').map(a => a.employee?.id))
    return emps.filter(e => !present.has(e.id))
  }, [emps, r])

  if (err) return <div className="max-w-5xl mx-auto"><Link href="/me/requests" className="text-sm text-gray-500 hover:text-gray-900">← 업무 요청</Link><div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{err}</div></div>
  if (!d || !r) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  const a = d.actions
  const ds = dueState(r)
  const flowIdx = FLOW.indexOf(r.status)
  const side = r.status === 'canceled' || r.status === 'rejected'
  const multi = r.assignees.length > 1
  const active = activeAssignees(r)
  const reported = active.filter(x => x.status === 'done_reported').length
  const acceptor = r.assign_mode === 'first' ? r.assignees.find(x => x.status !== 'invited' && x.status !== 'rejected' && x.status !== 'released') : null
  const my = r.assignees.find(x => x.employee?.id === d.me.id) ?? null
  const tagList = d.tags ?? []          // 태그 마스터 (904 미적용이면 빈 배열 — 태그 줄을 그리지 않는다)
  const myTags = tagsOf(r, tagList)
  const headLine = !multi
    ? (r.assignees[0]?.employee?.name ?? r.assignee?.name ?? '-')
    : r.assign_mode === 'first'
      ? (acceptor ? <>{r.assignees.length}명 중 <b className="text-gray-800">{acceptor.employee?.name} 수락</b></> : <>{active.length}명 중 수락 대기</>)
      : <>{r.assignees.length}명 공동{OPEN_STATUSES.includes(r.status) ? ` · 보고 ${reported}/${active.length}` : ''}</>
  // 담당자별 상태 표시 — 요청이 끝났을 때 미보고자는 "요청자가 완료 처리"
  const asgLabel = (x: WrAssignee) => r.status === 'completed' && (x.status === 'invited' || x.status === 'accepted' || x.status === 'in_progress') ? '요청자가 완료 처리' : r.status === 'canceled' && ASG_ACTIVE.includes(x.status) ? '요청 취소' : WR_ASG_LABEL[x.status]
  const completeConfirm = () => {
    const pending = active.filter(x => x.status !== 'done_reported').length
    const warn = r.assign_mode === 'all' && pending ? `\n아직 보고하지 않은 담당자 ${pending}명에게는 "요청자가 완료 처리함"으로 닫힙니다.` : ''
    if (window.confirm(`이 요청을 완료로 확정할까요?${warn}`)) act('complete')
  }

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/me/requests" className="text-sm text-gray-500 hover:text-gray-900">← 업무 요청</Link>
      {msg && <div className="mt-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {r.is_urgent && <span className="text-[0.6875rem] px-2 py-0.5 rounded bg-red-600 text-white font-semibold">긴급</span>}
        {multi && <span className={`text-[0.6875rem] px-2 py-0.5 rounded font-semibold ${r.assign_mode === 'first' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`} title={WR_MODE_DESC[r.assign_mode]}>{WR_MODE_LABEL[r.assign_mode]}</span>}
        {r.is_private && <span className="text-[0.6875rem] px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold" title="요청자 · 담당자 · 승인권자만 볼 수 있음">비공개</span>}
        <h1 className="text-2xl font-bold text-gray-900">{r.title}</h1>
        <span title={WR_STATUS_HINT[r.status]} className={`ml-auto inline-block px-2.5 py-1 rounded text-xs font-semibold whitespace-nowrap ${WR_STATUS_CLS[r.status]}`}>{WR_STATUS_LABEL[r.status]}{multi && r.assign_mode === 'all' && r.status === 'in_progress' ? ` (${reported}/${active.length} 보고)` : ''}</span>
      </div>
      {tagList.length > 0 ? (
        <div className="mt-2">
          {tagEdit === null ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              {myTags.length ? myTags.map(t => <TagChip key={t.id} tag={t} title={t.active ? undefined : '숨긴 태그 — 새 요청에서는 고를 수 없습니다'} />) : <span className="text-xs text-gray-400">업무 계열 미분류</span>}
              {d.actions.setTags && <button onClick={() => setTagEdit(r.tag_ids ?? [])} className="px-2 py-0.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">태그 수정</button>}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-xs font-medium text-gray-600 mb-1.5">업무 계열 <span className="text-[0.6875rem] text-gray-400 font-normal">1개 이상, 최대 {WR_TAG_MAX}개 · 바꾸면 이력에 남고 알림은 가지 않습니다</span></p>
              <TagPicker tags={tagList} value={tagEdit} onChange={setTagEdit} max={WR_TAG_MAX} onLimit={() => flash(`최대 ${WR_TAG_MAX}개까지 고를 수 있습니다.`)} />
              <div className="flex gap-1.5 mt-2.5">
                <button disabled={busy || !tagEdit.length} onClick={async () => { if (await act('set_tags', { tag_ids: tagEdit })) setTagEdit(null) }} className="px-3 py-1 bg-slate-900 text-white rounded text-xs font-medium disabled:opacity-50">저장</button>
                <button onClick={() => setTagEdit(null)} className="px-3 py-1 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50">취소</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      <p className="text-sm text-gray-500 mt-1">
        {r.requester?.name ?? '-'} → {headLine} · 요청 {fmtDTFull(r.created_at)} · 마감{' '}
        <span className={ds === 'overdue' ? 'text-red-600 font-medium' : ds === 'today' ? 'text-amber-600 font-medium' : ''}>{fmtDTFull(r.due_at)}{ds === 'overdue' ? ' (지남)' : ds === 'today' ? ' (오늘)' : ''}</span>
      </p>

      {/* 상태 흐름 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-3 text-xs">
        {FLOW.map((st, i) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={`px-2.5 py-1 rounded-full border ${!side && i === flowIdx ? 'bg-slate-900 text-white border-slate-900' : !side && i < flowIdx ? 'bg-gray-200 text-gray-600 border-gray-200' : 'bg-white text-gray-400 border-gray-200'}`}>
              {FLOW_LABEL[st]}{multi && r.assign_mode === 'all' && st === 'done_reported' ? ' (전원)' : ''}
            </span>
            {i < FLOW.length - 1 && <span className="text-gray-300">→</span>}
          </span>
        ))}
        {side && <span className={`ml-2 px-2.5 py-1 rounded-full ${WR_STATUS_CLS[r.status]}`}>{WR_STATUS_LABEL[r.status]}{r.status === 'rejected' && r.reject_reason ? ` — ${r.reject_reason}` : ''}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] mt-4">
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-900">내용</h2>
              {a.edit && <button onClick={() => setEditing(e => !e)} className="text-xs text-slate-600 hover:underline">{editing ? '닫기' : '수정'}</button>}
            </div>
            {editing ? (
              <div className="space-y-3">
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={5} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} placeholder="관련 링크 · 서버 경로" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <div className="flex items-center gap-4 flex-wrap">
                  <input type="datetime-local" value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={form.urgent} onChange={e => setForm(f => ({ ...f, urgent: e.target.checked }))} /> 긴급</label>
                </div>
                <button disabled={busy} onClick={async () => { if (await act('edit', { title: form.title, content: form.content, link: form.link, due_at: localToIso(form.due), is_urgent: form.urgent })) { setEditing(false); flash('수정되었습니다.') } }}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-50">저장</button>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{r.content || <span className="text-gray-400">내용 없음</span>}</p>
                {r.link && (
                  <p className="text-xs mt-3 flex items-center gap-2">
                    <span className="text-gray-400">관련:</span>
                    {/^https?:\/\//.test(r.link) ? <a href={r.link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{r.link}</a> : <span className="text-gray-700 break-all">{r.link}</span>}
                    <button onClick={() => navigator.clipboard?.writeText(r.link!).then(() => flash('복사했습니다.'))} className="px-1.5 py-0.5 border border-gray-300 rounded text-[0.6875rem] text-gray-600 hover:bg-gray-50">복사</button>
                  </p>
                )}
              </>
            )}
            {/* 첨부 파일 (1200) — 열린 요청의 요청자 · 담당자가 붙인다. 보기는 이 요청을 볼 수 있는 사람 전원 */}
            <AttachmentBox key={`${r.id}:${r.status}`} ownerType="work_request" ownerId={r.id} pasteAnywhere={!editing} className="mt-4 pt-3 border-t border-gray-100" />
          </div>

          {/* 담당자별 진행 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-900">담당자{multi ? ` ${r.assignees.length}명 · ${WR_MODE_LABEL[r.assign_mode]}` : ''}</h2>
              {a.addAssignee && <button onClick={() => { setAdding(x => !x); setAddIds([]) }} className="text-xs text-slate-600 hover:underline">{adding ? '닫기' : '담당자 추가'}</button>}
            </div>
            {multi && <p className="text-xs text-gray-500 mb-2">{WR_MODE_DESC[r.assign_mode]}</p>}
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">이름</th><th className="py-1.5 font-medium">상태</th><th className="py-1.5 font-medium">수락</th><th className="py-1.5 font-medium">보고</th><th className="py-1.5 font-medium">최근 메모 · 사유</th></tr></thead>
              <tbody>
                {r.assignees.map(x => {
                  const dim = x.status === 'released' || x.status === 'rejected'
                  return (
                    <tr key={x.id} className={`border-b border-gray-50 ${dim ? 'text-gray-400' : ''}`}>
                      <td className="py-1.5 whitespace-nowrap"><b className={dim ? '' : 'text-gray-900'}>{x.employee?.name ?? '-'}</b>{x.employee?.id === d.me.id && <span className="text-[0.625rem] text-slate-500 ml-1">(나)</span>}{x.employee?.id === r.requester?.id && <span className="text-[0.625rem] text-gray-400 ml-1">(요청자 겸)</span>}{x.employee?.team && <span className="text-xs text-gray-400 ml-1">{x.employee.team}</span>}</td>
                      <td className="py-1.5"><span className={`inline-block px-2 py-0.5 rounded text-[0.6875rem] font-semibold whitespace-nowrap ${WR_ASG_CLS[x.status]}`}>{asgLabel(x)}</span></td>
                      <td className="py-1.5 text-xs tabular-nums whitespace-nowrap">{x.accepted_at ? fmtDT(x.accepted_at) : '-'}</td>
                      <td className="py-1.5 text-xs tabular-nums whitespace-nowrap">{x.reported_at ? fmtDT(x.reported_at) : '-'}</td>
                      <td className="py-1.5 text-xs max-w-[260px] truncate">{x.status === 'rejected' && x.reject_reason ? `사유: ${x.reject_reason}` : x.status === 'released' ? '참고 표시만, 할 일 아님' : x.last_memo ?? <span className="text-gray-300">-</span>}</td>
                    </tr>
                  )
                })}
                {r.assignees.length === 0 && <tr><td colSpan={5} className="py-2 text-xs text-gray-400">담당자 정보가 없습니다 (902 마이그레이션 적용 전 요청).</td></tr>}
              </tbody>
            </table>
            {adding && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-600 mb-1.5">추가할 직원을 고르세요. {r.assign_mode === 'single' ? '추가하면 공동 방식(전원이 각자 진행)으로 바뀝니다.' : '추가된 사람은 미확인 상태로 시작합니다.'}</p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
                  {addCandidates.map(e => (
                    <button key={e.id} type="button" onClick={() => setAddIds(ids => ids.includes(e.id) ? ids.filter(i => i !== e.id) : [...ids, e.id])}
                      className={`px-2.5 py-1 rounded-full text-xs border ${addIds.includes(e.id) ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
                      {e.name}{e.team ? <span className="opacity-70"> · {e.team}</span> : ''}
                    </button>
                  ))}
                  {emps.length > 0 && addCandidates.length === 0 && <span className="text-xs text-gray-400">추가할 수 있는 직원이 없습니다.</span>}
                </div>
                <div className="flex gap-2 mt-2">
                  <button disabled={busy || !addIds.length} onClick={async () => { if (await act('add_assignee', { employee_ids: addIds })) { setAdding(false); setAddIds([]); flash('담당자를 추가했습니다.') } }}
                    className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-700 disabled:opacity-40">{addIds.length ? `${addIds.length}명 추가` : '추가'}</button>
                  <button onClick={() => { setAdding(false); setAddIds([]) }} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700">취소</button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">진행 메모 · 이력{multi ? <span className="text-xs text-gray-400 font-normal"> (담당자별 메모가 한 줄로 쌓임)</span> : null}</h2>
            <ul className="text-sm divide-y divide-gray-50">
              {d.events.map(e => (
                <li key={e.id} className="py-2 grid grid-cols-[110px_1fr] gap-3">
                  <span className="text-xs text-gray-400 tabular-nums pt-0.5">{fmtDT(e.created_at)}</span>
                  <span>
                    <span className="font-semibold text-gray-800">{e.actor?.name ?? '시스템'}</span>
                    <span className="text-gray-500"> {WR_EVENT_LABEL[e.event] ?? e.event}</span>
                    {e.memo && <span className="block text-gray-700 mt-0.5 whitespace-pre-wrap">{e.event === 'memo' || e.event === 'reported' ? e.memo : `— ${e.memo}`}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {a.memo && (
              <div className="flex gap-2 mt-3">
                <input value={memo} onChange={e => setMemo(e.target.value)} placeholder={multi && a.isAsg ? '내 진행 메모 입력' : '진행 메모 입력'}
                  onKeyDown={async e => { if (e.key === 'Enter' && memo.trim()) { if (await act('memo', { memo: memo.trim() })) setMemo('') } }}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <button disabled={busy || !memo.trim()} onClick={async () => { if (await act('memo', { memo: memo.trim() })) setMemo('') }}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">메모 추가</button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {(a.accept || a.reject || a.report) && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-3">{multi ? '내 조작' : '담당자 조작'}</h2>
              <div className="flex flex-col gap-2">
                {a.accept && <button disabled={busy} onClick={() => act('accept')} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">수락{r.assign_mode === 'first' ? ' (먼저 수락하면 내가 담당)' : ''}</button>}
                {a.report && <button disabled={busy} onClick={() => { const m = window.prompt('처리 완료 보고 — 결과 메모 (선택)'); if (m !== null) act('report', { memo: m.trim() || undefined }) }}
                  className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">처리 완료 보고</button>}
                {a.reject && <button disabled={busy} onClick={() => { const m = window.prompt('반려 사유를 입력하세요 (필수).'); if (m?.trim()) act('reject', { memo: m.trim() }) }}
                  className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50">반려 (사유 필수)</button>}
                {a.report && <p className="text-xs text-gray-400">{r.assign_mode === 'all' ? '내 몫만 보고합니다. 다른 사람 진행은 담당자 표에서 확인. 전원이 보고하면 요청자가 완료를 확정합니다.' : '보고하면 요청자가 확인 후 완료를 확정합니다.'}</p>}
              </div>
            </div>
          )}
          {my && !a.accept && !a.reject && !a.report && OPEN_STATUSES.includes(r.status) && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-600">
              {my.status === 'released' ? '다른 사람이 수락한 요청입니다. 참고로만 보이며 할 일에서는 빠집니다.' : my.status === 'done_reported' ? (r.status === 'done_reported' ? '내 보고가 끝났습니다. 요청자의 완료 확정을 기다립니다.' : '내 보고가 끝났습니다. 다른 담당자의 보고를 기다립니다.') : my.status === 'rejected' ? '내가 반려한 요청입니다.' : null}
            </div>
          )}
          {(a.complete || a.cancel) && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-3">요청자 조작</h2>
              <div className="flex flex-col gap-2">
                {a.complete && <button disabled={busy} onClick={completeConfirm}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">완료 확정</button>}
                {a.cancel && <button disabled={busy} onClick={() => { if (window.confirm('이 요청을 취소할까요?')) act('cancel') }}
                  className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">요청 취소</button>}
                {r.assign_mode === 'all' && a.complete && r.status !== 'done_reported' && <p className="text-xs text-gray-400">전원 보고 전에도 완료 확정은 가능합니다(요청자 판단). 미보고자에게는 &quot;요청자가 완료 처리함&quot;으로 닫힙니다.</p>}
              </div>
            </div>
          )}
          {r.status === 'rejected' && a.isReq && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-2">반려됨</h2>
              <p className="text-sm text-gray-700">{r.reject_reason}</p>
              <button onClick={() => router.push(`/me/requests/new?from=${r.id}`)} className="mt-3 px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700">수정해서 다시 요청</button>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl p-5 text-xs text-gray-500 space-y-1">
            <p>요청자 <b className="text-gray-800">{r.requester?.name}</b>{r.requester?.team ? ` · ${r.requester.team}` : ''}</p>
            {!multi && <p>담당자 <b className="text-gray-800">{r.assignees[0]?.employee?.name ?? r.assignee?.name}</b>{(r.assignees[0]?.employee?.team ?? r.assignee?.team) ? ` · ${r.assignees[0]?.employee?.team ?? r.assignee?.team}` : ''}</p>}
            {multi && <p>담당자 <b className="text-gray-800">{r.assignees.length}명</b> · {WR_MODE_LABEL[r.assign_mode]}{acceptor ? ` · 수락 ${acceptor.employee?.name}` : ''}</p>}
            {r.accepted_at && <p>{multi && r.assign_mode === 'all' ? '첫 수락' : '수락'} {fmtDTFull(r.accepted_at)}</p>}
            {r.reported_at && <p>처리 보고{multi && r.assign_mode === 'all' ? ' (전원)' : ''} {fmtDTFull(r.reported_at)}</p>}
            {r.completed_at && <p>완료 확정 {fmtDTFull(r.completed_at)}</p>}
            {r.canceled_at && <p>취소 {fmtDTFull(r.canceled_at)}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
