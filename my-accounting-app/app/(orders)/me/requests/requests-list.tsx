'use client'

// 업무 요청 목록 — 받은 요청(담당자 입장) / 보낸 요청(요청자 입장). 요약 카드 클릭 = 필터.
// 기본은 열린 건만, '완료·취소 포함'을 켜면 최근 90일 닫힌 건도. 정렬: 긴급 → 마감 임박.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WR_STATUS_LABEL, WR_STATUS_CLS, OPEN_STATUSES, dueState, fmtDue, fmtDT, type WrRow, type WrStatus } from '@/lib/work-requests'

type Filter = 'all' | 'unread' | 'active' | 'due_today' | 'overdue' | 'reported' | 'rejected'

interface Resp {
  linked: boolean
  me: { id: string; name: string | null } | null
  rows: WrRow[]
  summary: Record<string, number> | null
  error?: string
}

export default function RequestsList({ box }: { box: 'inbox' | 'outbox' }) {
  const router = useRouter()
  const [data, setData] = useState<Resp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState<'' | WrStatus>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    const res = await fetch(`/api/work-requests?box=${box}${closed ? '&closed=1' : ''}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? '조회 실패'); return }
    setData(json); setErr(null)
  }, [box, closed])
  useEffect(() => { load() }, [load])
  useEffect(() => { setFilter('all'); setStatusF('') }, [box])

  const act = async (id: string, action: string, memo?: string) => {
    setBusy(id)
    const res = await fetch(`/api/work-requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, memo }) })
    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { flash(json.error ?? '처리 실패'); return }
    load()
  }
  const reject = (r: WrRow) => { const reason = window.prompt(`'${r.title}' 요청을 반려합니다. 사유를 입력하세요 (필수).`); if (reason?.trim()) act(r.id, 'reject', reason.trim()) }
  const cancel = (r: WrRow) => { if (window.confirm(`'${r.title}' 요청을 취소할까요?`)) act(r.id, 'cancel') }
  const complete = (r: WrRow) => { if (window.confirm(`'${r.title}' 요청을 완료로 확정할까요?`)) act(r.id, 'complete') }
  const report = (r: WrRow) => { const memo = window.prompt('처리 완료 보고 — 결과 메모 (선택)') ; if (memo !== null) act(r.id, 'report', memo.trim() || undefined) }

  const rows = data?.rows ?? []
  const now = new Date()
  const visible = useMemo(() => rows.filter(r => {
    const ds = dueState(r, now)
    if (filter === 'unread' && r.status !== 'requested') return false
    if (filter === 'active' && !(r.status === 'accepted' || r.status === 'in_progress')) return false
    if (filter === 'due_today' && ds !== 'today') return false
    if (filter === 'overdue' && ds !== 'overdue') return false
    if (filter === 'reported' && r.status !== 'done_reported') return false
    if (filter === 'rejected' && r.status !== 'rejected') return false
    if (statusF && r.status !== statusF) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = [r.title, r.content, r.requester?.name, r.assignee?.name, r.last_memo].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, filter, statusF, search])

  if (err) return <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{err}</div>
  if (!data) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  if (!data.linked) return <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">직원 정보와 연결되지 않은 계정입니다. 인사 · 총무 담당자에게 연결을 요청하세요.</div>

  const s = data.summary ?? {}
  const open = rows.filter(r => OPEN_STATUSES.includes(r.status))
  const cnt = (f: (r: WrRow) => boolean) => open.filter(f).length
  const cards: { key: Filter; label: string; value: number; cls: string; sub?: string }[] = box === 'inbox' ? [
    { key: 'unread', label: '미확인', value: s.inbox_unread ?? 0, cls: 'text-red-600', sub: '수락 · 반려 대기' },
    { key: 'active', label: '진행 중', value: s.inbox_active ?? 0, cls: 'text-blue-700', sub: '수락 포함' },
    { key: 'due_today', label: '오늘 마감', value: s.inbox_due_today ?? 0, cls: 'text-amber-600' },
    { key: 'overdue', label: '마감 지남', value: s.inbox_overdue ?? 0, cls: 'text-red-600', sub: '처리 보고 전' },
    { key: 'reported', label: '완료 대기', value: s.inbox_reported ?? 0, cls: 'text-gray-900', sub: '요청자 확정 전' },
  ] : [
    { key: 'unread', label: '미확인', value: cnt(r => r.status === 'requested'), cls: 'text-gray-900', sub: '담당자 확인 전' },
    { key: 'active', label: '진행 중', value: cnt(r => r.status === 'accepted' || r.status === 'in_progress'), cls: 'text-blue-700' },
    { key: 'overdue', label: '마감 지남', value: s.outbox_overdue ?? 0, cls: 'text-red-600' },
    { key: 'reported', label: '완료 대기', value: s.outbox_awaiting ?? 0, cls: 'text-amber-600', sub: '내가 확정할 것' },
    { key: 'rejected', label: '반려됨', value: s.outbox_rejected ?? 0, cls: 'text-red-600', sub: '수정 후 재요청 또는 취소' },
  ]

  const dueCell = (r: WrRow) => {
    const ds = dueState(r, now)
    return (
      <span className={`tabular-nums whitespace-nowrap ${ds === 'overdue' ? 'text-red-600 font-medium' : ds === 'today' ? 'text-amber-600 font-medium' : 'text-gray-700'}`}>
        {fmtDue(r.due_at)}{ds === 'overdue' && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">지남</span>}
      </span>
    )
  }

  return (
    <div>
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {cards.map(c => (
          <button key={c.key} onClick={() => setFilter(f => f === c.key ? 'all' : c.key)}
            className={`text-left bg-white border rounded-xl px-4 py-3 transition-colors ${filter === c.key ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:bg-gray-50'}`}>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-lg font-bold mt-0.5 tabular-nums ${c.cls}`}>{c.value}</p>
            {c.sub && <p className="text-[11px] text-gray-400 mt-0.5">{c.sub}</p>}
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
        <label className="text-xs text-gray-600 flex items-center gap-1"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} /> 완료 · 취소 포함 (최근 90일)</label>
        {(filter !== 'all' || statusF || search) && <button onClick={() => { setFilter('all'); setStatusF(''); setSearch('') }} className="text-xs text-gray-500 underline">필터 해제</button>}
        <span className="ml-auto text-xs text-gray-400">{visible.length.toLocaleString()}건</span>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm bg-white border border-gray-200 rounded-xl">
          {rows.length === 0 ? (box === 'inbox' ? '받은 요청이 없습니다.' : '보낸 요청이 없습니다.') : '조건에 맞는 요청이 없습니다.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium w-10"></th>
                <th className="py-2.5 px-3 font-medium">요청</th>
                <th className="py-2.5 px-3 font-medium">{box === 'inbox' ? '요청자' : '담당자'}</th>
                <th className="py-2.5 px-3 font-medium">요청일</th>
                <th className="py-2.5 px-3 font-medium">마감</th>
                <th className="py-2.5 px-3 font-medium">상태</th>
                <th className="py-2.5 px-3 font-medium">최근 메모</th>
                <th className="py-2.5 px-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const other = box === 'inbox' ? r.requester : r.assignee
                const b = busy === r.id
                return (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/me/requests/${r.id}`)}>
                    <td className="py-2 px-3">{r.is_urgent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold">긴급</span>}</td>
                    <td className="py-2 px-3 min-w-[220px] max-w-[420px]">
                      <p className="font-semibold text-gray-900 truncate">{r.title}</p>
                      {r.content && <p className="text-xs text-gray-500 truncate">{r.content}</p>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-gray-700">{other?.name ?? '-'}{other?.team && <span className="text-xs text-gray-400 ml-1">{other.team}</span>}</td>
                    <td className="py-2 px-3 whitespace-nowrap text-gray-500 text-xs tabular-nums">{fmtDT(r.created_at)}</td>
                    <td className="py-2 px-3">{dueCell(r)}</td>
                    <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap ${WR_STATUS_CLS[r.status]}`}>{WR_STATUS_LABEL[r.status]}</span></td>
                    <td className="py-2 px-3 text-xs text-gray-500 max-w-[260px] truncate">{r.status === 'rejected' && r.reject_reason ? `반려: ${r.reject_reason}` : r.last_memo ?? '-'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {box === 'inbox' ? (
                        <>
                          {r.status === 'requested' && <><button disabled={b} onClick={() => act(r.id, 'accept')} className="px-2 py-1 text-xs border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 mr-1">수락</button>
                            <button disabled={b} onClick={() => reject(r)} className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50">반려</button></>}
                          {(r.status === 'accepted' || r.status === 'in_progress') && <button disabled={b} onClick={() => report(r)} className="px-2 py-1 text-xs bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50">처리 완료</button>}
                          {r.status === 'done_reported' && <span className="text-xs text-gray-400">요청자 확정 대기</span>}
                        </>
                      ) : (
                        <>
                          {OPEN_STATUSES.includes(r.status) && <><button disabled={b} onClick={() => complete(r)} className="px-2 py-1 text-xs border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 mr-1">완료</button>
                            <button disabled={b} onClick={() => cancel(r)} className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50">취소</button></>}
                          {r.status === 'rejected' && <Link href={`/me/requests/new?from=${r.id}`} className="px-2 py-1 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50">다시 요청</Link>}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-3">행을 누르면 상세(내용 · 이력 · 메모)로 갑니다. 마감 색: 오늘 = 주황, 지남 = 빨강. 수락과 완료 확정은 담당자 업무일지에 자동으로 남습니다.</p>
    </div>
  )
}
