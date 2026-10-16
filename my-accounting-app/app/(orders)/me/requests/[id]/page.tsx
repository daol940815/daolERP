'use client'

// 업무 요청 상세 — 상태 흐름 · 내용 · 이력(메모) · 역할별 조작. 조작 가능 여부는 API가 내려준 actions 로 판정(서버와 동일 규칙).

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  WR_STATUS_LABEL, WR_STATUS_CLS, WR_EVENT_LABEL, dueState, fmtDTFull, fmtDT, isoToLocal, localToIso,
  type WrRow, type WrEventRow, type WrStatus,
} from '@/lib/work-requests'

interface Detail {
  row: WrRow
  events: WrEventRow[]
  me: { id: string | null }
  actions: { accept: boolean; reject: boolean; memo: boolean; report: boolean; complete: boolean; cancel: boolean; edit: boolean; isReq: boolean; isAsg: boolean }
}
const FLOW: WrStatus[] = ['requested', 'accepted', 'in_progress', 'done_reported', 'completed']
const FLOW_LABEL: Record<string, string> = { requested: '요청', accepted: '수락', in_progress: '진행 중', done_reported: '처리 보고', completed: '완료' }

export default function WorkRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
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

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    const res = await fetch(`/api/work-requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '처리 실패'); return false }
    await load()
    return true
  }

  if (err) return <div className="max-w-5xl mx-auto"><Link href="/me/requests" className="text-sm text-gray-500 hover:text-gray-900">← 업무 요청</Link><div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{err}</div></div>
  if (!d) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  const { row: r, actions: a } = d
  const ds = dueState(r)
  const flowIdx = FLOW.indexOf(r.status)
  const side = r.status === 'canceled' || r.status === 'rejected'

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/me/requests" className="text-sm text-gray-500 hover:text-gray-900">← 업무 요청</Link>
      {msg && <div className="mt-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {r.is_urgent && <span className="text-[11px] px-2 py-0.5 rounded bg-red-600 text-white font-semibold">긴급</span>}
        <h1 className="text-2xl font-bold text-gray-900">{r.title}</h1>
        <span className={`ml-auto inline-block px-2.5 py-1 rounded text-xs font-semibold ${WR_STATUS_CLS[r.status]}`}>{WR_STATUS_LABEL[r.status]}</span>
      </div>
      <p className="text-sm text-gray-500 mt-1">
        {r.requester?.name ?? '-'} → {r.assignee?.name ?? '-'} · 요청 {fmtDTFull(r.created_at)} · 마감{' '}
        <span className={ds === 'overdue' ? 'text-red-600 font-medium' : ds === 'today' ? 'text-amber-600 font-medium' : ''}>{fmtDTFull(r.due_at)}{ds === 'overdue' ? ' (지남)' : ds === 'today' ? ' (오늘)' : ''}</span>
      </p>

      {/* 상태 흐름 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-3 text-xs">
        {FLOW.map((st, i) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={`px-2.5 py-1 rounded-full border ${!side && i === flowIdx ? 'bg-slate-900 text-white border-slate-900' : !side && i < flowIdx ? 'bg-gray-200 text-gray-600 border-gray-200' : 'bg-white text-gray-400 border-gray-200'}`}>{FLOW_LABEL[st]}</span>
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
                    <button onClick={() => navigator.clipboard?.writeText(r.link!).then(() => flash('복사했습니다.'))} className="px-1.5 py-0.5 border border-gray-300 rounded text-[11px] text-gray-600 hover:bg-gray-50">복사</button>
                  </p>
                )}
              </>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">진행 메모 · 이력</h2>
            <ul className="text-sm divide-y divide-gray-50">
              {d.events.map(e => (
                <li key={e.id} className="py-2 grid grid-cols-[110px_1fr] gap-3">
                  <span className="text-xs text-gray-400 tabular-nums pt-0.5">{fmtDT(e.created_at)}</span>
                  <span>
                    <span className="font-semibold text-gray-800">{e.actor?.name ?? '시스템'}</span>
                    <span className="text-gray-500"> {WR_EVENT_LABEL[e.event]}</span>
                    {e.memo && <span className="block text-gray-700 mt-0.5 whitespace-pre-wrap">{e.event === 'memo' || e.event === 'reported' ? e.memo : `— ${e.memo}`}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {a.memo && (
              <div className="flex gap-2 mt-3">
                <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="진행 메모 입력"
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
              <h2 className="text-sm font-bold text-gray-900 mb-3">담당자 조작</h2>
              <div className="flex flex-col gap-2">
                {a.accept && <button disabled={busy} onClick={() => act('accept')} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">수락</button>}
                {a.report && <button disabled={busy} onClick={() => { const m = window.prompt('처리 완료 보고 — 결과 메모 (선택)'); if (m !== null) act('report', { memo: m.trim() || undefined }) }}
                  className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">처리 완료 보고</button>}
                {a.reject && <button disabled={busy} onClick={() => { const m = window.prompt('반려 사유를 입력하세요 (필수).'); if (m?.trim()) act('reject', { memo: m.trim() }) }}
                  className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50">반려 (사유 필수)</button>}
                {a.report && <p className="text-xs text-gray-400">보고하면 요청자가 확인 후 완료를 확정합니다.</p>}
              </div>
            </div>
          )}
          {(a.complete || a.cancel) && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-3">요청자 조작</h2>
              <div className="flex flex-col gap-2">
                {a.complete && <button disabled={busy} onClick={() => { if (window.confirm('이 요청을 완료로 확정할까요?')) act('complete') }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">완료 확정</button>}
                {a.cancel && <button disabled={busy} onClick={() => { if (window.confirm('이 요청을 취소할까요?')) act('cancel') }}
                  className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">요청 취소</button>}
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
            <p>담당자 <b className="text-gray-800">{r.assignee?.name}</b>{r.assignee?.team ? ` · ${r.assignee.team}` : ''}</p>
            {r.accepted_at && <p>수락 {fmtDTFull(r.accepted_at)}</p>}
            {r.reported_at && <p>처리 보고 {fmtDTFull(r.reported_at)}</p>}
            {r.completed_at && <p>완료 확정 {fmtDTFull(r.completed_at)}</p>}
            {r.canceled_at && <p>취소 {fmtDTFull(r.canceled_at)}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
