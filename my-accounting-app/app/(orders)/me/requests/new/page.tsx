'use client'

// 새 업무 요청 — 담당자 다수 지정(검색 + 칩, 팀 단위 빠른 선택) · 담당자 2명 이상이면 진행 방식(선착/공동) 선택 (902, 2026-11-02)
// 오른쪽: 선택한 담당자가 지금 맡고 있는 업무(열린 요청) — 근태·휴가 대신(2026-11-02 사용자 요청). 여유 판단은 요청자가 한다.
// 마감은 필수(기본 당일 18:00), 긴급·비공개 체크. 본인에게 요청 가능.
// ?from=<id> 로 들어오면(반려 건 다시 요청) 그 요청의 내용·담당자·방식·태그를 미리 채운다.
// 첨부 파일(1200, 2026-11-11): 작성 중 올린 파일은 draft_key 로 묶였다가 요청 저장 시 연결. 저장하지 않으면 하루 뒤 정리.
// 업무 계열 태그(904, 2026-11-10): 1개 이상 · 최대 3개. 제목 · 내용 키워드로 추천(점선)만 하고 확정은 사용자. 질문하기 · 권한 요청은 ERP 문의 자동.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { defaultDueLocal, localToIso, isoToLocal, fmtDue, kstParts, WR_MODE_DESC, WR_ASG_LABEL, WR_ASG_CLS, WR_TAG_MAX, WR_TAG_ERP_CODE, recommendTagIds, type WrRow, type WrMode, type WrStatus, type WrAsgStatus, type WrTag } from '@/lib/work-requests'
import { TagPicker } from '@/components/work-requests/tag-chip'
import { HELP_QUESTION_PREFIX, HELP_PERMISSION_PREFIX } from '@/lib/help-registry'
import { GROUP_LABELS, type GroupKey } from '@/lib/permissions'
import { deviceLabelFrom } from '@/lib/push'
import AttachmentBox from '@/components/attachments/AttachmentBox'

// 질문 · 권한 요청의 기본 마감: 익일 18:00 (KST) — 2026-11-03 결정 ⑤
function questionDueLocal(now = new Date()): string {
  const k = kstParts(new Date(now.getTime() + 86400_000))
  return `${k.date}T18:00`
}

interface Emp { id: string; name: string; team: string | null; position: string | null; employment_type: string }
interface LoadItem { id: string; title: string; due_at: string; status: WrStatus; my_status: WrAsgStatus; is_urgent: boolean; is_private: boolean; hidden: boolean; requester: string | null }
interface Load { id: string; items: LoadItem[]; total: number; hidden: number; overdue: number; due_today: number }
const SHOW_PER_PERSON = 3

export default function NewRequestPage() {
  return <Suspense fallback={<div className="text-gray-400 text-sm p-6">로딩 중...</div>}><NewRequestForm /></Suspense>
}

function NewRequestForm() {
  const router = useRouter()
  const sp = useSearchParams()
  const [emps, setEmps] = useState<Emp[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [assignees, setAssignees] = useState<string[]>([])
  const [mode, setMode] = useState<WrMode>('first')
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [link, setLink] = useState('')
  const [due, setDue] = useState(() => defaultDueLocal())
  const [urgent, setUrgent] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [tags, setTags] = useState<WrTag[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [tagHint, setTagHint] = useState<string | null>(null)
  const [loads, setLoads] = useState<Record<string, Load>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [draftKey] = useState(() => crypto.randomUUID())   // 작성 중 올린 첨부를 묶는 키 — 저장할 때 서버가 이 요청에 연결 (1200)

  useEffect(() => {
    // 태그 마스터 (904 미적용이면 빈 목록 — 태그 줄을 숨긴다)
    fetch('/api/work-requests/tags').then(r => r.json()).then(j => {
      const list: WrTag[] = j.tags ?? []
      setTags(list)
      if (sp.get('question')) { const erp = list.find(t => t.code === WR_TAG_ERP_CODE && t.active); if (erp) setTagIds([erp.id]) }
      const fromId = sp.get('from')
      if (fromId) {
        fetch(`/api/work-requests/${fromId}`).then(r => r.json()).then(d => {
          const prev: string[] = d.row?.tag_ids ?? []
          setTagIds(prev.filter(id => list.some(t => t.id === id && t.active)).slice(0, WR_TAG_MAX))
        }).catch(() => null)
      }
    }).catch(() => null)
    fetch('/api/work-requests/employees').then(r => r.json()).then(j => {
      setEmps(j.data ?? []); setMeId(j.me ?? null)
      // 도움말 "질문하기" · "권한 요청하기" (도움말 트랙, 2026-11-03): 담당자 = 질문 수신자, 제목 접두 · 내용 틀 · 마감 익일 18:00 미리 채움. 공개(기본).
      const q = sp.get('question')
      if (q) {
        const screen = sp.get('screen') ?? q
        const perm = sp.get('perm')
        const meEmp = (j.data as Emp[] | undefined)?.find(e => e.id === j.me)
        if (j.question_recipient) setAssignees([j.question_recipient])
        setTitle(perm ? `${HELP_PERMISSION_PREFIX} ${screen} — ${GROUP_LABELS[perm as GroupKey] ?? perm} 수정 권한 요청` : `${HELP_QUESTION_PREFIX} ${screen} — `)
        setContent([
          perm ? '어떤 작업을 하려는지 적어주세요 (예: 원가표 업로드).' : '무엇을 하려다 어디서 막혔는지 적어주세요.', '', '',
          '---- 자동 첨부 ----', `화면: ${q}`, `계정: ${meEmp?.name ?? ''}${meEmp?.team ? ` (${meEmp.team})` : ''}`, `브라우저: ${deviceLabelFrom(navigator.userAgent)}`,
        ].join('\n'))
        setDue(questionDueLocal())
      }
    }).catch(() => null)
    const from = sp.get('from')
    if (from) {
      fetch(`/api/work-requests/${from}`).then(r => r.json()).then(j => {
        const r: WrRow | undefined = j.row
        if (!r) return
        const ids = r.assignees.length ? r.assignees.map(a => a.employee?.id).filter((x): x is string => !!x) : (r.assignee ? [r.assignee.id] : [])
        setAssignees(ids); if (r.assign_mode !== 'single') setMode(r.assign_mode)
        setTitle(r.title); setContent(r.content ?? ''); setLink(r.link ?? ''); setUrgent(r.is_urgent); setIsPrivate(!!r.is_private)
        if (new Date(r.due_at) > new Date()) setDue(isoToLocal(r.due_at))
      }).catch(() => null)
    }
  }, [sp])

  // 선택한 담당자들의 맡은 업무 — 선택이 바뀔 때마다 한 번에 조회
  useEffect(() => {
    if (!assignees.length) { setLoads({}); return }
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/work-requests/staff-status?employee_ids=${assignees.join(',')}`, { signal: ctrl.signal, cache: 'no-store' })
      .then(r => r.json()).then(j => { if (!j.error) setLoads(Object.fromEntries((j.employees as Load[]).map(e => [e.id, e]))) })
      .catch(() => null).finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [assignees])

  const empById = useMemo(() => new Map(emps.map(e => [e.id, e])), [emps])
  // 팀 버튼: 팀별(재직·로그인 직원 기준) + 아르바이트 + 전 직원 (2026-11-02 결정 ①)
  const teams = useMemo(() => {
    const m = new Map<string, Emp[]>()
    for (const e of emps) if (e.team && e.employment_type !== 'parttime') m.set(e.team, [...(m.get(e.team) ?? []), e])
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  }, [emps])
  const parttime = useMemo(() => emps.filter(e => e.employment_type === 'parttime'), [emps])
  const addMany = (ids: string[]) => setAssignees(prev => Array.from(new Set([...prev, ...ids])))
  const toggle = (id: string) => setAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return emps.filter(e => !assignees.includes(e.id) && (e.name.toLowerCase().includes(q) || (e.team ?? '').toLowerCase().includes(q) || (e.position ?? '').toLowerCase().includes(q))).slice(0, 8)
  }, [emps, assignees, query])
  const allSelected = emps.length > 0 && emps.every(e => assignees.includes(e.id))
  const hasTags = tags.some(t => t.active)
  const recommended = useMemo(() => recommendTagIds(`${title} ${content}`, tags), [title, content, tags])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    if (!assignees.length) { setError('담당자를 선택하세요.'); return }
    if (!title.trim()) { setError('제목을 입력하세요.'); return }
    if (!due) { setError('마감 일시를 입력하세요.'); return }
    if (hasTags && !tagIds.length) { setError('업무 계열을 하나 이상 고르세요.'); return }
    setBusy(true)
    const res = await fetch('/api/work-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_ids: assignees, assign_mode: assignees.length > 1 ? mode : undefined, title: title.trim(), content, link, due_at: localToIso(due), is_urgent: urgent, is_private: isPrivate, tag_ids: tagIds, draft_key: draftKey }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '요청 실패'); return }
    if (json.warning) window.alert(json.warning)
    router.push(`/me/requests/${json.id}`)
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'
  const quickBtn = 'px-2.5 py-1 text-xs border border-slate-300 rounded-full text-slate-700 hover:bg-slate-100 disabled:opacity-40'
  const now = new Date()
  const todayKst = kstParts(now).date
  const totalOpen = assignees.reduce((s, id) => s + (loads[id]?.total ?? 0), 0)

  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/me/requests" className="text-sm text-gray-500 hover:text-gray-900">← 업무 요청</Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-1">{sp.get('question') ? (sp.get('perm') ? '권한 요청' : '질문하기') : '새 요청'}</h1>
      {sp.get('question') && <p className="text-sm text-gray-500 mt-1">업무 요청으로 보내집니다. 담당자가 진행 메모로 답하고 처리 보고하면 완료 확정해 주세요. 같은 질문이 반복되면 도움말에 반영됩니다.</p>}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] mt-4">
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

          {/* 담당자 — 검색 + 칩 + 팀 버튼 */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-gray-600">담당자 <span className="text-red-500">*</span></span>
              <span className="text-[0.6875rem] text-gray-400">이름을 입력해 추가하거나 팀 버튼으로 한 번에</span>
            </div>
            <div className="relative mt-1">
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="이름 · 팀 검색 (예: 김주, 영업지원)"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (candidates[0]) { toggle(candidates[0].id); setQuery('') } } if (e.key === 'Escape') setQuery('') }}
                className={`${inputCls} bg-white`} />
              {candidates.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto text-sm">
                  {candidates.map(e => (
                    <li key={e.id}><button type="button" onClick={() => { toggle(e.id); setQuery(''); searchRef.current?.focus() }} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2">
                      <span className="font-medium text-gray-900">{e.name}</span>
                      <span className="text-xs text-gray-500">{e.team ?? '-'}{e.position ? ` · ${e.position}` : ''}{e.employment_type === 'parttime' ? ' · 아르바이트' : ''}{e.id === meId ? ' · 나' : ''}</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {teams.map(([team, list]) => <button key={team} type="button" onClick={() => addMany(list.map(e => e.id))} disabled={list.every(e => assignees.includes(e.id))} className={quickBtn}>+ {team} ({list.length})</button>)}
              {parttime.length > 0 && <button type="button" onClick={() => addMany(parttime.map(e => e.id))} disabled={parttime.every(e => assignees.includes(e.id))} className={quickBtn}>+ 아르바이트 ({parttime.length})</button>}
              <button type="button" onClick={() => addMany(emps.map(e => e.id))} disabled={allSelected} className={quickBtn}>+ 전 직원 ({emps.length})</button>
              {assignees.length > 0 && <button type="button" onClick={() => setAssignees([])} className="px-2.5 py-1 text-xs text-gray-500 underline">모두 지우기</button>}
            </div>
            {assignees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {assignees.map(id => { const e = empById.get(id); return (
                  <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-900 text-white text-xs">
                    {e?.name ?? '직원'}{e?.team && <span className="text-slate-300">· {e.team}</span>}{id === meId && <span className="text-slate-300">(나)</span>}
                    <button type="button" onClick={() => toggle(id)} className="ml-0.5 text-slate-300 hover:text-white" aria-label="제거">✕</button>
                  </span>
                ) })}
                <span className="text-xs text-gray-500 self-center">{assignees.length}명</span>
              </div>
            )}
          </div>

          {/* 진행 방식 — 2명 이상일 때만 */}
          {assignees.length > 1 && (
            <div>
              <span className="text-xs font-medium text-gray-600">진행 방식 <span className="text-red-500">*</span> <span className="text-[0.6875rem] text-gray-400 font-normal">담당자 2명 이상</span></span>
              <div className="grid sm:grid-cols-2 gap-2 mt-1">
                {(['first', 'all'] as WrMode[]).map(m => (
                  <label key={m} className={`border rounded-lg px-3 py-2.5 cursor-pointer ${mode === m ? 'border-slate-900 ring-1 ring-slate-900 bg-slate-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                      <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                      <span className="text-sm font-semibold text-gray-900">{m === 'first' ? '선착 — 한 명이 수락하면 그 사람이 진행' : '공동 — 전원이 각자 진행'}</span>
                    </div>
                    <p className="text-[0.6875rem] text-gray-500 mt-1 leading-relaxed">{WR_MODE_DESC[m]} {m === 'first' ? '예: "이 전화 누가 좀 해줘".' : '예: "각자 담당 거래처 수금 확인".'}</p>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-gray-600">제목 <span className="text-red-500">*</span></span>
            <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} placeholder="예: 이편한 김포 수금 독촉 통화" className={`${inputCls} mt-1`} />
          </label>
          {hasTags && (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-gray-600">업무 계열 <span className="text-red-500">*</span></span>
                <span className="text-[0.6875rem] text-gray-400">1개 이상, 최대 {WR_TAG_MAX}개</span>
              </div>
              <div className="mt-1.5">
                <TagPicker tags={tags} value={tagIds} onChange={ids => { setTagIds(ids); setTagHint(null) }} recommended={recommended} max={WR_TAG_MAX} onLimit={() => setTagHint(`최대 ${WR_TAG_MAX}개까지 고를 수 있습니다.`)} />
              </div>
              <p className={`text-[0.6875rem] mt-1.5 ${tagHint ? 'text-amber-700' : 'text-gray-400'}`}>
                {tagHint ?? (tagIds.length ? `${tagIds.length}개 선택` : recommended.length ? '점선 = 제목 · 내용의 단어로 추천한 계열입니다. 눌러서 확정하세요.' : '이 요청이 어떤 계열의 일인지 고르세요.')}
              </p>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium text-gray-600">내용</span>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={5} placeholder="무엇을 · 어디까지 · 결과를 어떻게 남길지" className={`${inputCls} mt-1`} />
          </label>
          <div className="flex gap-4 flex-wrap items-end">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">마감 일시 <span className="text-red-500">*</span></span>
              <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} required className={`${inputCls} mt-1 w-auto`} />
            </label>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />
              <span className={urgent ? 'text-red-600 font-semibold' : 'text-gray-700'}>긴급</span>
            </label>
            <label className="flex items-center gap-2 text-sm pb-2" title="요청자 · 담당자 · 승인권자만 볼 수 있습니다. 전체(공용) 목록에 나오지 않습니다.">
              <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
              <span className={isPrivate ? 'text-slate-900 font-semibold' : 'text-gray-700'}>비공개</span>
            </label>
            <span className="text-xs text-gray-400 pb-2">기본값 당일 18:00 · 비공개는 당사자와 승인권자만 조회</span>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">관련 링크 · 서버 경로 (선택)</span>
            <input value={link} onChange={e => setLink(e.target.value)} placeholder="ERP 화면 주소, 회사 서버 경로, 문서 주소" className={`${inputCls} mt-1`} />
          </label>
          <AttachmentBox ownerType="work_request" draftKey={draftKey} pasteAnywhere />
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">{busy ? '보내는 중...' : assignees.length > 1 ? `요청 보내기 (${assignees.length}명 · ${mode === 'first' ? '선착' : '공동'})` : '요청 보내기'}</button>
            <Link href="/me/requests" className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</Link>
          </div>
        </form>

        {/* 선택한 담당자가 맡고 있는 업무 */}
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-sm self-start">
          {assignees.length === 0 ? (
            <p className="text-gray-400">담당자를 선택하면 그 사람이 지금 맡고 있는 업무가 여기에 보입니다.</p>
          ) : (
            <>
              <p className="font-bold text-gray-900">선택한 담당자가 맡고 있는 업무 <span className="text-xs text-gray-500 font-normal">({assignees.length}명 · 열린 요청 {totalOpen}건{loading ? ' · 불러오는 중' : ''})</span></p>
              <div className="mt-3 divide-y divide-slate-200">
                {assignees.map(id => {
                  const e = empById.get(id); const l = loads[id]
                  const items = l?.items ?? []
                  return (
                    <div key={id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/me/requests?tab=all&employee=${id}`} className="font-semibold text-gray-900 hover:underline">{e?.name ?? '직원'}</Link>
                        {e?.team && <span className="text-xs text-gray-400">{e.team}</span>}
                        {l && <span className="text-xs text-gray-500 ml-auto">{l.total ? `${l.total}건` : '맡은 업무 없음'}{l.overdue ? <span className="text-red-600 font-medium"> · 지남 {l.overdue}</span> : ''}{l.due_today ? <span className="text-amber-600 font-medium"> · 오늘 {l.due_today}</span> : ''}</span>}
                      </div>
                      {items.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {items.slice(0, SHOW_PER_PERSON).map(it => {
                            const dueT = new Date(it.due_at)
                            const tracked = it.my_status !== 'done_reported'
                            const over = tracked && dueT < now, today = tracked && !over && kstParts(dueT).date === todayKst
                            return (
                              <li key={it.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-xs">
                                <span className={`truncate ${it.hidden ? 'text-gray-400' : 'text-gray-800'}`}>
                                  {it.is_urgent && <span className="text-[0.625rem] px-1 rounded bg-red-600 text-white mr-1">긴급</span>}
                                  {it.hidden ? it.title : <Link href={`/me/requests/${it.id}`} className="hover:underline">{it.title}</Link>}
                                  {it.requester && <span className="text-gray-400"> · {it.requester}</span>}
                                </span>
                                <span className={`tabular-nums whitespace-nowrap ${over ? 'text-red-600 font-medium' : today ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>{fmtDue(it.due_at)}{over ? ' 지남' : today ? ' 오늘' : ''}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[0.625rem] font-semibold whitespace-nowrap ${WR_ASG_CLS[it.my_status]}`}>{WR_ASG_LABEL[it.my_status]}</span>
                              </li>
                            )
                          })}
                          {items.length > SHOW_PER_PERSON && (
                            <li className="text-xs text-gray-400">그 외 {items.length - SHOW_PER_PERSON}건{l!.hidden ? ` (비공개 ${l!.hidden}건 포함)` : ''} — <Link href={`/me/requests?tab=all&employee=${id}`} className="underline">전체 목록</Link></li>
                          )}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-4">열린 요청(미확인 · 수락 · 진행 중 · 처리 보고)만, 마감 순. 비공개 요청은 당사자와 승인권자가 아니면 제목이 가려집니다. 여유 판단은 요청자가 합니다.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
