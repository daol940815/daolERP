'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// 업무일지 — 계정이 ERP에서 진행한 업무 이력.
// 자동 기재(상담·주문·영업일지)와 직접 기재(ERP 밖 업무)를 한 화면에서 시간순으로 본다.
// 자동 기재 줄은 수정 불가, 직접 기재 줄만 본인이 수정·삭제한다.

interface Row {
  id: string
  work_date: string
  logged_at: string
  source: 'auto' | 'manual'
  action: string
  category: string | null
  content: string
  ref_type: 'consultation' | 'order' | 'activity' | null
  ref_id: string | null
}

interface Data {
  rows: Row[]
  counts: Record<string, number>
  month: string
  employees: { id: string; name: string }[]
  role: string
  employee_id: string | null
  employee_name: string | null
  is_self: boolean
  categories: string[]
  actions: string[]
  hint?: string
}

const ACTION_STYLE: Record<string, string> = {
  상담작성: 'bg-blue-50 text-blue-700',
  상담수정: 'bg-sky-50 text-sky-700',
  주문전환: 'bg-violet-50 text-violet-700',
  주문작성: 'bg-emerald-50 text-emerald-700',
  주문수정: 'bg-teal-50 text-teal-700',
  영업일지: 'bg-amber-50 text-amber-700',
  직접기재: 'bg-slate-100 text-slate-700',
}

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const dayLabel = (d: string) => {
  const [, m, dd] = d.split('-')
  return `${m}월 ${dd}일 (${DOW[new Date(`${d}T00:00:00+09:00`).getDay()]})`
}
const timeLabel = (ts: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts))

const drilldown = (r: Row) => {
  if (r.ref_type === 'consultation' && r.ref_id) return { href: `/orders/consultations/${r.ref_id}`, label: '상담일지 보기' }
  if (r.ref_type === 'order' && r.ref_id) return { href: `/orders/${r.ref_id}`, label: '주문서 보기' }
  if (r.ref_type === 'activity') return { href: '/me/journal', label: '영업일지 보기' }
  return null
}

const monthOptions = () => {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default function MyWorklogPage() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7))
  const [action, setAction] = useState('all')
  const [employee, setEmployee] = useState('')

  // 팀 업무 현황에서 ?employee=… 로 넘어온 경우 (useSearchParams는 정적 렌더 제약이 있어 직접 읽는다)
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('employee')
    if (v) setEmployee(v)
  }, [])

  // 직접 기재 폼
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('기타')
  const [workDate, setWorkDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const qs = new URLSearchParams({ month, action })
    if (employee) qs.set('employee', employee)
    const res = await fetch(`/api/me/worklog?${qs}`)
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setData(null) }
    else setData(json)
    setLoading(false)
  }, [month, action, employee])
  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!content.trim()) { alert('업무 내용을 입력해주세요.'); return }
    setSaving(true)
    const res = await fetch('/api/me/worklog', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, category, work_date: workDate || undefined }),
    })
    setSaving(false)
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '저장 실패'); return }
    setContent(''); setWorkDate('')
    load()
  }

  const saveEdit = async (id: string) => {
    if (!editContent.trim()) return
    const res = await fetch(`/api/me/worklog?id=${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent, category: editCategory }),
    })
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '수정 실패'); return }
    setEditing(null); load()
  }

  const remove = async (id: string) => {
    if (!confirm('이 기록을 삭제할까요?')) return
    const res = await fetch(`/api/me/worklog?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '삭제 실패'); return }
    load()
  }

  // 날짜별 그룹
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of data?.rows ?? []) {
      const arr = map.get(r.work_date)
      if (arr) arr.push(r)
      else map.set(r.work_date, [r])
    }
    return Array.from(map.entries())
  }, [data])

  const counts = data?.counts ?? {}
  const sum = (...keys: string[]) => keys.reduce((s, k) => s + (counts[k] ?? 0), 0)
  // KPI 클릭 = 그 묶음으로 필터 (카드 숫자와 목록 건수가 일치하도록 콤마 묶음을 넘긴다)
  const kpis = [
    { key: 'all', label: '이번 달 업무', value: Object.values(counts).reduce((a, b) => a + b, 0), sub: '전체 보기' },
    { key: '상담작성,상담수정', label: '상담일지', value: sum('상담작성', '상담수정'), sub: `작성 ${counts['상담작성'] ?? 0} · 수정 ${counts['상담수정'] ?? 0}` },
    { key: '주문작성,주문수정,주문전환', label: '주문서', value: sum('주문작성', '주문수정', '주문전환'), sub: `작성 ${counts['주문작성'] ?? 0} · 수정 ${counts['주문수정'] ?? 0} · 전환 ${counts['주문전환'] ?? 0}` },
    { key: '직접기재,영업일지', label: '직접 기재 · 영업', value: sum('직접기재', '영업일지'), sub: `직접 ${counts['직접기재'] ?? 0} · 영업일지 ${counts['영업일지'] ?? 0}` },
  ]

  const isManager = data?.role === 'manager' || data?.role === 'admin'
  const readOnly = !!data && !data.is_self

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">업무일지</h1>
        <span className="text-xs text-gray-400">
          ERP에서 한 업무는 자동으로 기록됩니다. ERP 밖 업무만 직접 기재하세요.
        </span>
        {isManager && (
          <div className="ml-auto flex items-center gap-2">
            <select value={employee} onChange={e => setEmployee(e.target.value)}
              className="border border-blue-200 bg-blue-50 rounded-lg px-2.5 py-1.5 text-sm text-slate-700">
              <option value="">내 업무일지</option>
              {(data?.employees ?? []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <Link href="/me/team-worklog"
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              팀 업무 현황
            </Link>
          </div>
        )}
      </div>

      {error && <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {data?.hint && <div className="mt-4 px-4 py-2.5 bg-amber-50 text-amber-800 text-sm rounded-lg">{data.hint}</div>}
      {readOnly && (
        <div className="mt-4 px-4 py-2.5 bg-blue-50 text-blue-800 text-sm rounded-lg">
          {data?.employee_name ?? '직원'} 님의 업무일지를 보는 중입니다. (열람 전용)
        </div>
      )}

      {/* KPI — 클릭 시 유형 필터 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
        {kpis.map(k => {
          const on = action === k.key
          return (
            <button key={k.key} onClick={() => setAction(k.key)}
              className={`text-left bg-white border rounded-xl px-3.5 py-3 transition-colors ${
                on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="text-xs text-gray-500">{k.label}</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{k.value}</div>
              <div className="text-[10.5px] text-gray-400 mt-0.5">{k.sub}</div>
            </button>
          )
        })}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 flex-wrap mt-4">
        <select value={month} onChange={e => setMonth(e.target.value)}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-700">
          {monthOptions().map(m => <option key={m} value={m}>{m.replace('-', '년 ')}월</option>)}
        </select>
        {['all', ...(data?.actions ?? [])].map(a => (
          <button key={a} onClick={() => setAction(a)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              action === a ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {a === 'all' ? '전체' : a}
          </button>
        ))}
      </div>

      {/* 직접 기재 — 본인 화면에서만 */}
      {!readOnly && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 mt-4 flex gap-2 flex-wrap items-center">
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-slate-700">
            {(data?.categories ?? ['기타']).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={workDate} onChange={e => setWorkDate(e.target.value)} type="date"
            className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-slate-700" />
          <input value={content} onChange={e => setContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !saving) submit() }}
            placeholder="ERP 밖에서 한 업무를 한 줄로 적어주세요 (예: 배송 포장 40건, 거래처 방문 회의)"
            className="flex-1 min-w-[240px] border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {saving ? '저장 중' : '기재'}
          </button>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">로딩 중...</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">이 기간에 기록된 업무가 없습니다.</div>
      ) : groups.map(([date, rows]) => (
        <div key={date} className="mt-5">
          <div className="flex items-center gap-2 mb-1.5">
            <b className="text-sm text-gray-900">{dayLabel(date)}</b>
            <span className="text-xs text-gray-400">{rows.length}건</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {rows.map(r => {
              const link = drilldown(r)
              return (
                <div key={r.id} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-gray-50 last:border-b-0 hover:bg-slate-50">
                  <span className="text-[11px] text-gray-400 w-10 shrink-0 tabular-nums">{timeLabel(r.logged_at)}</span>
                  <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full w-16 text-center shrink-0 ${ACTION_STYLE[r.action] ?? 'bg-gray-100 text-gray-600'}`}>
                    {r.action}
                  </span>
                  {editing === r.id ? (
                    <>
                      <input value={editContent} onChange={e => setEditContent(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(r.id) }}
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" autoFocus />
                      <button onClick={() => saveEdit(r.id)} className="text-xs text-blue-600">저장</button>
                      <button onClick={() => setEditing(null)} className="text-xs text-gray-400">취소</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-[12.5px] text-gray-800">
                        {r.category && <span className="text-gray-400">[{r.category}] </span>}
                        {r.content}
                      </span>
                      {link && <Link href={link.href} className="text-[11px] text-blue-600 hover:underline whitespace-nowrap">{link.label}</Link>}
                      {r.source === 'manual' && !readOnly && (
                        <>
                          <button onClick={() => { setEditing(r.id); setEditContent(r.content); setEditCategory(r.category) }}
                            className="text-[11px] text-gray-400 hover:text-gray-600">수정</button>
                          <button onClick={() => remove(r.id)}
                            className="text-[11px] text-gray-400 hover:text-red-600">삭제</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
