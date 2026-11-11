'use client'

// 업무 요청 목록 — 전체(공용) / 내가 받은(담당자 입장) / 내가 보낸(요청자 입장). 요약 카드 클릭 = 필터.
// 내가 받은·보낸: 기본은 열린 건만, '완료·취소 포함'을 켜면 최근 90일 닫힌 건도. 정렬: 생성일시 내림차순(최근 요청이 위).
// 전체(2026-11-02 공용 전환): 지금 열린 건 전부 + 선택한 달(기본 이달)에 생성된 건. 비공개는 당사자·승인권자만 보인다.
// ?employee= 로 들어오면(경영 현황 드릴다운) 그 직원이 요청자·담당자인 건만.
// 업무 계열 태그(904, 2026-11-10): 필터 바 아래 태그 칩 줄(건수 · 여러 개 = 또는) + 제목 위 태그. 기존 '질문 · 권한 요청만' 칩은 ERP 문의 태그가 대신한다.
// 902: 담당자 열은 다수를 요약(선착 "수락자 (외 N 해제)", 공동 "N명 · 보고 k/N"), 내가 담당자인 건은 '내 몫' 상태가 따로 보인다.
//      조작 버튼은 서버와 같은 규칙(allowedActions)으로 내 몫 기준.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  WR_STATUS_LABEL, WR_STATUS_CLS, WR_STATUS_HINT, WR_MODE_LABEL, WR_ASG_LABEL, WR_ASG_CLS, OPEN_STATUSES, dueState, myDueState, fmtDue, fmtDT, kstParts,
  allowedActions, assigneeSummary, myShare, isAssigneeOf, WR_TAG_NONE, type WrRow, type WrStatus, type WrScope, type WrTag,
} from '@/lib/work-requests'
import { TagChip, NoTagChip, TagList } from '@/components/work-requests/tag-chip'
import { useNotifRefresh, requestNotifRefresh } from '@/lib/use-notif-refresh'
import { HELP_QUESTION_PREFIX, HELP_PERMISSION_PREFIX } from '@/lib/help-registry'

type Filter = 'all' | 'unread' | 'active' | 'due_today' | 'overdue' | 'reported' | 'rejected' | 'open' | 'personal' | 'shared'

interface Resp {
  linked: boolean
  me: { id: string; name: string | null; approver: boolean; master?: boolean } | null
  rows: WrRow[]
  tags?: WrTag[]   // 904 — 태그 마스터(숨김 포함). 미적용이면 빈 배열
  summary: Record<string, number> | null
  month?: string
  hiddenPrivate?: number
  error?: string
}
const matchTag = (r: WrRow, id: string) => id === WR_TAG_NONE ? !(r.tag_ids?.length) : !!r.tag_ids?.includes(id)
const FILTERS: Filter[] = ['all', 'unread', 'active', 'due_today', 'overdue', 'reported', 'rejected', 'open', 'personal', 'shared']

export default function RequestsList({ scope, month: monthProp, employee, initialFilter, initialTag }: { scope: WrScope; month?: string; employee?: string; initialFilter?: string; initialTag?: string }) {
  const router = useRouter()
  const [data, setData] = useState<Resp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [month, setMonth] = useState(() => monthProp && /^\d{4}-\d{2}$/.test(monthProp) ? monthProp : kstParts(new Date()).date.slice(0, 7))
  const [filter, setFilter] = useState<Filter>(() => (FILTERS as string[]).includes(initialFilter ?? '') ? initialFilter as Filter : 'all')
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState<'' | WrStatus>('')
  const [onlyQ, setOnlyQ] = useState(false)   // 도움말 질문 · 권한 요청만 ([질문] · [권한] 접두, 2026-11-03)
  // 업무 계열 태그 필터(904) — 여러 개 고르면 하나라도 해당하는 요청(또는). 'none' = 미분류. ?tag=<id> 로 들어오면 미리 선택(경영 현황 드릴다운)
  const [tagF, setTagF] = useState<string[]>(() => initialTag ? [initialTag] : [])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    const p = new URLSearchParams({ scope })
    if (closed && scope !== 'all') p.set('closed', '1')
    if (scope === 'all') p.set('month', month)
    if (employee) p.set('employee', employee)
    const res = await fetch(`/api/work-requests?${p}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? '조회 실패'); return }
    setData(json); setErr(null)
  }, [scope, closed, month, employee])
  useEffect(() => { load() }, [load])
  useEffect(() => { setStatusF('') }, [scope])
  useNotifRefresh(load)   // 알림 폴링·실시간 신호가 오면(다른 사람의 요청·수락·보고) 목록도 자동 갱신

  const act = async (id: string, action: string, memo?: string) => {
    setBusy(id)
    const res = await fetch(`/api/work-requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, memo }) })
    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { flash(json.error ?? '처리 실패'); load(); return }
    load(); requestNotifRefresh()
  }
  const reject = (r: WrRow) => { const reason = window.prompt(`'${r.title}' 요청을 반려합니다. 사유를 입력하세요 (필수).`); if (reason?.trim()) act(r.id, 'reject', reason.trim()) }
  const cancel = (r: WrRow) => { if (window.confirm(`'${r.title}' 요청을 취소할까요?`)) act(r.id, 'cancel') }
  const complete = (r: WrRow) => {
    const pending = r.assignees.filter(a => a.status === 'accepted' || a.status === 'in_progress' || a.status === 'invited').length
    const warn = r.assign_mode === 'all' && pending ? `\n아직 보고하지 않은 담당자 ${pending}명에게는 "요청자가 완료 처리함"으로 닫힙니다.` : ''
    if (window.confirm(`'${r.title}' 요청을 완료로 확정할까요?${warn}`)) act(r.id, 'complete')
  }
  const report = (r: WrRow) => { const memo = window.prompt('처리 완료 보고 — 결과 메모 (선택)'); if (memo !== null) act(r.id, 'report', memo.trim() || undefined) }

  const rows = data?.rows ?? []
  const meId = data?.me?.id ?? null
  const now = new Date()
  // 마감 판정: 내가 받은 탭은 내 몫 기준(공동에서 내가 보고했으면 배지 없음), 그 외는 요청 기준
  const dsOf = (r: WrRow) => scope === 'inbox' ? myDueState(r, meId, now) : dueState(r, now)
  const base = useMemo(() => rows.filter(r => {
    const ds = dsOf(r)
    const my = myShare(r, meId)
    if (filter === 'unread' && !(scope === 'inbox' && my ? my.status === 'invited' : r.status === 'requested')) return false
    if (filter === 'active' && !(scope === 'inbox' && my ? (my.status === 'accepted' || my.status === 'in_progress') : (r.status === 'accepted' || r.status === 'in_progress'))) return false
    if (filter === 'due_today' && ds !== 'today') return false
    if (filter === 'overdue' && ds !== 'overdue') return false
    if (filter === 'reported' && !(scope === 'inbox' && my ? my.status === 'done_reported' && OPEN_STATUSES.includes(r.status) : r.status === 'done_reported')) return false
    if (filter === 'rejected' && r.status !== 'rejected') return false
    if (filter === 'open' && !OPEN_STATUSES.includes(r.status)) return false
    if (filter === 'personal' && r.assignees.length > 1) return false   // 개인 요청 = 담당자 1명 (알림 종류 분리, 2026-11-04)
    if (filter === 'shared' && r.assignees.length <= 1) return false     // 공용 요청 = 다수 담당(선착 · 공동)
    if (statusF && r.status !== statusF) return false
    if (onlyQ && !(r.title.startsWith(HELP_QUESTION_PREFIX) || r.title.startsWith(HELP_PERMISSION_PREFIX))) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = [r.title, r.content, r.requester?.name, r.assignee?.name, ...r.assignees.map(a => a.employee?.name), r.last_memo].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, filter, statusF, search, scope, meId, onlyQ])
  const tags = useMemo(() => data?.tags ?? [], [data])
  const hasTags = tags.length > 0
  const visible = useMemo(() => !hasTags || !tagF.length ? base : base.filter(r => tagF.some(id => matchTag(r, id))), [base, tagF, hasTags])
  // 칩 숫자 = 다른 조건을 적용한 목록 안의 건수 (태그 조건 제외)
  const tagCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of base) {
      if (!r.tag_ids?.length) m.set(WR_TAG_NONE, (m.get(WR_TAG_NONE) ?? 0) + 1)
      else for (const id of r.tag_ids) m.set(id, (m.get(id) ?? 0) + 1)
    }
    return m
  }, [base])
  const toggleTag = (id: string) => setTagF(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id])

  if (err) return <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{err}</div>
  if (!data) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  if (!data.linked) return <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">직원 정보와 연결되지 않은 계정입니다. 인사 · 총무 담당자에게 연결을 요청하세요.</div>

  const s = data.summary ?? {}
  const open = rows.filter(r => OPEN_STATUSES.includes(r.status))
  const cnt = (f: (r: WrRow) => boolean) => open.filter(f).length
  const cards: { key: Filter; label: string; value: number; cls: string; sub?: string }[] = scope === 'inbox' ? [
    { key: 'unread', label: '미확인', value: s.inbox_unread ?? 0, cls: 'text-red-600', sub: '수락 · 반려 대기' },
    { key: 'active', label: '진행 중', value: s.inbox_active ?? 0, cls: 'text-blue-700', sub: '수락 포함 · 내 몫' },
    { key: 'due_today', label: '오늘 마감', value: s.inbox_due_today ?? 0, cls: 'text-amber-600' },
    { key: 'overdue', label: '마감 지남', value: s.inbox_overdue ?? 0, cls: 'text-red-600', sub: '내 보고 전' },
    { key: 'reported', label: '완료 확정 대기', value: s.inbox_reported ?? 0, cls: 'text-gray-900', sub: '내가 보고, 요청자 확정 전' },
  ] : scope === 'outbox' ? [
    { key: 'unread', label: '미확인', value: cnt(r => r.status === 'requested'), cls: 'text-gray-900', sub: '담당자 확인 전' },
    { key: 'active', label: '진행 중', value: cnt(r => r.status === 'accepted' || r.status === 'in_progress'), cls: 'text-blue-700' },
    { key: 'overdue', label: '마감 지남', value: s.outbox_overdue ?? 0, cls: 'text-red-600' },
    { key: 'reported', label: '완료 확정 대기', value: s.outbox_awaiting ?? 0, cls: 'text-amber-600', sub: '내가 확정할 것' },
    { key: 'rejected', label: '반려됨', value: s.outbox_rejected ?? 0, cls: 'text-red-600', sub: '수정 후 재요청 또는 취소' },
  ] : [
    { key: 'open', label: '진행 중 전체', value: open.length, cls: 'text-blue-700', sub: '지금 열린 건' },
    { key: 'unread', label: '미확인', value: cnt(r => r.status === 'requested'), cls: 'text-gray-900', sub: '담당자 확인 전' },
    { key: 'due_today', label: '오늘 마감', value: cnt(r => dueState(r, now) === 'today'), cls: 'text-amber-600' },
    { key: 'overdue', label: '마감 지남', value: cnt(r => dueState(r, now) === 'overdue'), cls: 'text-red-600', sub: '처리 보고 전' },
    { key: 'reported', label: '완료 확정 대기', value: cnt(r => r.status === 'done_reported'), cls: 'text-gray-900', sub: '요청자 확정 전' },
  ]

  const dueCell = (r: WrRow) => {
    const ds = dsOf(r)
    return (
      <span className={`tabular-nums whitespace-nowrap ${ds === 'overdue' ? 'text-red-600 font-medium' : ds === 'today' ? 'text-amber-600 font-medium' : 'text-gray-700'}`}>
        {fmtDue(r.due_at)}{ds === 'overdue' && <span className="ml-1.5 text-[0.625rem] px-1.5 py-0.5 rounded bg-red-100 text-red-700">지남</span>}
      </span>
    )
  }
  const empName = employee
    ? (rows.find(r => r.requester?.id === employee)?.requester?.name ?? rows.flatMap(r => r.assignees).find(a => a.employee?.id === employee)?.employee?.name ?? '선택 직원')
    : null
  const clearEmployee = () => { const p = new URLSearchParams(); p.set('tab', scope); if (scope === 'all') p.set('month', month); router.push(`/me/requests?${p}`) }
  const showMine = scope !== 'outbox' && rows.some(r => isAssigneeOf(r, meId))

  return (
    <div>
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {cards.map(c => (
          <button key={c.key} onClick={() => setFilter(f => f === c.key ? 'all' : c.key)}
            className={`text-left bg-white border rounded-xl px-4 py-3 transition-colors ${filter === c.key ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:bg-gray-50'}`}>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-lg font-bold mt-0.5 tabular-nums ${c.cls}`}>{c.value}</p>
            {c.sub && <p className="text-[0.6875rem] text-gray-400 mt-0.5">{c.sub}</p>}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="제목 · 내용 · 이름 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <select value={statusF} onChange={e => setStatusF(e.target.value as '' | WrStatus)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">상태: 전체</option>
          {(Object.keys(WR_STATUS_LABEL) as WrStatus[]).map(k => <option key={k} value={k}>{WR_STATUS_LABEL[k]}</option>)}
        </select>
        {scope === 'all' ? (
          <label className="text-xs text-gray-600 flex items-center gap-1.5">생성 월 <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm" /><span className="text-gray-400">열린 건은 달과 무관하게 전부</span></label>
        ) : (
          <label className="text-xs text-gray-600 flex items-center gap-1"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} /> 완료 · 취소 포함 (최근 90일)</label>
        )}
        {scope !== 'outbox' && rows.some(r => r.assignees.length > 1) && (
          <>
            <button onClick={() => setFilter(f => f === 'personal' ? 'all' : 'personal')} className={`text-xs px-2.5 py-1 rounded-full border ${filter === 'personal' ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`} title="담당자가 나 혼자인 요청">개인 요청만</button>
            <button onClick={() => setFilter(f => f === 'shared' ? 'all' : 'shared')} className={`text-xs px-2.5 py-1 rounded-full border ${filter === 'shared' ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`} title="여러 명이 담당인 요청(선착 · 공동)">공용 요청만</button>
          </>
        )}
        {!hasTags && rows.some(r => r.title.startsWith(HELP_QUESTION_PREFIX) || r.title.startsWith(HELP_PERMISSION_PREFIX)) && (
          <button onClick={() => setOnlyQ(v => !v)} className={`text-xs px-2.5 py-1 rounded-full border ${onlyQ ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>질문 · 권한 요청만</button>
        )}
        {employee && <button onClick={clearEmployee} className="text-xs px-2.5 py-1 bg-slate-100 rounded-full text-slate-700">{empName} 관련만 보는 중 ✕</button>}
        {(filter !== 'all' || statusF || search || onlyQ || tagF.length > 0) && <button onClick={() => { setFilter('all'); setStatusF(''); setSearch(''); setOnlyQ(false); setTagF([]) }} className="text-xs text-gray-500 underline">필터 해제</button>}
        <span className="ml-auto text-xs text-gray-400">{visible.length.toLocaleString()}건{scope === 'all' && data.hiddenPrivate ? ` · 비공개 ${data.hiddenPrivate}건 제외` : ''}</span>
      </div>
      {hasTags && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <span className="text-xs text-gray-500 mr-1">업무 계열</span>
          {tags.filter(t => t.active || tagCount.get(t.id) || tagF.includes(t.id)).map(t => (
            <TagChip key={t.id} tag={t} selected={tagF.includes(t.id)} count={tagCount.get(t.id) ?? 0} onClick={() => toggleTag(t.id)} title={t.active ? undefined : '숨긴 태그'} />
          ))}
          {(tagCount.get(WR_TAG_NONE) || tagF.includes(WR_TAG_NONE)) ? <NoTagChip selected={tagF.includes(WR_TAG_NONE)} count={tagCount.get(WR_TAG_NONE) ?? 0} onClick={() => toggleTag(WR_TAG_NONE)} /> : null}
          {tagF.length > 0 && <span className="text-xs text-gray-500 ml-1">{tagF.length}개 선택{tagF.length > 1 ? ' · 하나라도 해당' : ''} <button onClick={() => setTagF([])} className="underline">해제</button></span>}
          {data.me?.master && <Link href="/me/requests/tags" className="ml-auto text-xs text-gray-500 hover:text-gray-900 underline">태그 관리</Link>}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm bg-white border border-gray-200 rounded-xl">
          {rows.length === 0 ? (scope === 'inbox' ? '받은 요청이 없습니다.' : scope === 'outbox' ? '보낸 요청이 없습니다.' : '요청이 없습니다.') : '조건에 맞는 요청이 없습니다.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium w-10"></th>
                <th className="py-2.5 px-3 font-medium">요청</th>
                {scope !== 'outbox' && <th className="py-2.5 px-3 font-medium">요청자</th>}
                {scope !== 'inbox' && <th className="py-2.5 px-3 font-medium">담당자</th>}
                {showMine && <th className="py-2.5 px-3 font-medium">내 몫</th>}
                <th className="py-2.5 px-3 font-medium">요청일</th>
                <th className="py-2.5 px-3 font-medium">마감</th>
                <th className="py-2.5 px-3 font-medium">상태</th>
                <th className="py-2.5 px-3 font-medium">최근 메모</th>
                <th className="py-2.5 px-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const b = busy === r.id
                const a = allowedActions(r, meId)
                const my = myShare(r, meId)
                const sum = assigneeSummary(r)
                const multi = r.assignees.length > 1
                const person = (p: WrRow['requester'], mine: boolean) => <span className="whitespace-nowrap text-gray-700">{p?.name ?? '-'}{mine && <span className="text-[0.625rem] text-slate-500 ml-1">(나)</span>}{p?.team && <span className="text-xs text-gray-400 ml-1">{p.team}</span>}</span>
                return (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/me/requests/${r.id}`)}>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.is_urgent && <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold">긴급</span>}
                      {multi && <span className={`text-[0.625rem] px-1.5 py-0.5 rounded font-semibold ml-1 ${r.assign_mode === 'first' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`} title={r.assign_mode === 'first' ? '선착 — 먼저 수락한 1명이 진행' : '공동 — 전원이 각자 진행'}>{WR_MODE_LABEL[r.assign_mode]}</span>}
                      {r.is_private && <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold ml-1" title="요청자 · 담당자 · 승인권자만 볼 수 있음">비공개</span>}
                    </td>
                    <td className="py-2 px-3 min-w-[220px] max-w-[420px]">
                      {hasTags && <TagList row={r} tags={tags} className="mb-0.5" />}
                      <p className="font-semibold text-gray-900 truncate">{r.title}</p>
                      {r.content && <p className="text-xs text-gray-500 truncate">{r.content}</p>}
                    </td>
                    {scope !== 'outbox' && <td className="py-2 px-3">{person(r.requester, a.isReq)}</td>}
                    {scope !== 'inbox' && (
                      <td className="py-2 px-3 whitespace-nowrap text-gray-700">
                        {sum.main}{!multi && my && <span className="text-[0.625rem] text-slate-500 ml-1">(나)</span>}
                        {sum.sub && <span className="text-xs text-gray-400 ml-1">{sum.sub}</span>}
                      </td>
                    )}
                    {showMine && (
                      <td className="py-2 px-3 whitespace-nowrap">
                        {my ? <span className={`inline-block px-2 py-0.5 rounded text-[0.6875rem] font-semibold ${WR_ASG_CLS[my.status]}`}>{r.status === 'completed' && my.status !== 'done_reported' && my.status !== 'rejected' && my.status !== 'released' ? '요청자가 완료 처리' : WR_ASG_LABEL[my.status]}</span> : <span className="text-gray-300">-</span>}
                      </td>
                    )}
                    <td className="py-2 px-3 whitespace-nowrap text-gray-500 text-xs tabular-nums">{fmtDT(r.created_at)}</td>
                    <td className="py-2 px-3">{dueCell(r)}</td>
                    <td className="py-2 px-3"><span title={WR_STATUS_HINT[r.status]} className={`inline-block px-2 py-0.5 rounded text-[0.6875rem] font-semibold whitespace-nowrap ${WR_STATUS_CLS[r.status]}`}>{WR_STATUS_LABEL[r.status]}</span></td>
                    <td className="py-2 px-3 text-xs text-gray-500 max-w-[260px] truncate">{r.status === 'rejected' && r.reject_reason ? `반려: ${r.reject_reason}` : r.last_memo ?? '-'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {a.accept && <button disabled={b} onClick={() => act(r.id, 'accept')} className="px-2 py-1 text-xs border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 mr-1">수락</button>}
                      {a.reject && my?.status === 'invited' && <button disabled={b} onClick={() => reject(r)} className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50">반려</button>}
                      {a.report && <button disabled={b} onClick={() => report(r)} className="px-2 py-1 text-xs bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50">처리 완료</button>}
                      {my?.status === 'done_reported' && OPEN_STATUSES.includes(r.status) && !a.isReq && <span className="text-xs text-gray-400">{r.assign_mode === 'all' && r.status !== 'done_reported' ? '다른 담당자 보고 대기' : '요청자 확정 대기'}</span>}
                      {my?.status === 'released' && <span className="text-xs text-gray-400">조작 없음</span>}
                      {a.complete && <button disabled={b} onClick={() => complete(r)} className="px-2 py-1 text-xs border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 ml-1">완료</button>}
                      {a.cancel && <button disabled={b} onClick={() => cancel(r)} className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50 ml-1">취소</button>}
                      {a.isReq && r.status === 'rejected' && <Link href={`/me/requests/new?from=${r.id}`} className="px-2 py-1 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50">다시 요청</Link>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-3">
        행을 누르면 상세(내용 · 이력 · 메모)로 갑니다. 마감 색: 오늘 = 주황, 지남 = 빨강. 조작 버튼은 내가 담당자 · 요청자인 건에만 보입니다.
        {' '}담당자가 여러 명인 요청은 선착(먼저 수락한 1명이 진행) · 공동(전원이 각자 진행) 배지가 붙고, 내 몫 상태가 따로 보입니다.
        {scope === 'all' && ' 전체 목록은 모든 직원이 볼 수 있고, 비공개 요청은 요청자 · 담당자 · 승인권자에게만 보입니다.'}
      </p>
    </div>
  )
}
