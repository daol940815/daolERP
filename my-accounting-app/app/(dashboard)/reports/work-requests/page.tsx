'use client'

// 업무 요청 현황 — 경영 현황(조회 전용). 월 단위: 이달 생성분 + 지금 열린 건. 직원별 집계 · 지금 신경 쓸 것 · 전체 목록.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { WR_STATUS_LABEL, WR_STATUS_CLS, OPEN_STATUSES, dueState, fmtDue, fmtDT, kstParts, type WrRow } from '@/lib/work-requests'

interface Overview {
  summary: { month: string; created: number; completed: number; canceled: number; rejected: number; open: number; overdue: number; unread_24h: number; avg_hours_to_report: number | null }
  employees: { id: string; name: string; team: string | null; received: number; open: number; overdue: number; completed: number; sent: number }[]
  attention: (WrRow & { reason: 'overdue' | 'unread' })[]
  rows: WrRow[]
}

export default function WorkRequestsOverviewPage() {
  const [month, setMonth] = useState(() => kstParts(new Date()).date.slice(0, 7))
  const [team, setTeam] = useState('')
  const [emp, setEmp] = useState<string | null>(null)
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/work-requests/overview?month=${month}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setErr(json.error ?? '조회 실패'); return }
    setData(json); setErr(null)
  }, [month])
  useEffect(() => { load() }, [load])

  const teams = useMemo(() => Array.from(new Set((data?.employees ?? []).map(e => e.team).filter((t): t is string => !!t))).sort((a, b) => a.localeCompare(b, 'ko')), [data])
  const employees = useMemo(() => (data?.employees ?? []).filter(e => !team || e.team === team), [data, team])
  const rows = useMemo(() => (data?.rows ?? []).filter(r => (!emp || r.assignee?.id === emp || r.requester?.id === emp) && (!team || r.assignee?.team === team || r.requester?.team === team)), [data, emp, team])

  if (err) return <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{err}</div>
  if (!data) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  const s = data.summary
  const empName = emp ? data.employees.find(e => e.id === emp)?.name : null
  const kpi = (k: string, v: React.ReactNode, sub?: string) => (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3"><p className="text-xs text-gray-500">{k}</p><p className="text-lg font-bold mt-0.5 tabular-nums">{v}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>
  )

  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold text-gray-900">업무 요청 현황</h1>
      <p className="text-sm mt-1 text-gray-500">직원별 업무 요청 진행 상태. 조회 전용이며 평가 지표로 쓰지 않습니다.</p>
      <div className="flex items-center gap-2 flex-wrap mt-3 mb-4">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={team} onChange={e => { setTeam(e.target.value); setEmp(null) }} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">팀: 전체</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {emp && <button onClick={() => setEmp(null)} className="text-xs px-2.5 py-1 bg-slate-100 rounded-full text-slate-700">{empName} 만 보기 ✕</button>}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {kpi('이달 요청', s.created, `완료 ${s.completed} · 취소 ${s.canceled} · 반려 ${s.rejected}`)}
        {kpi('진행 중', <span className="text-blue-700">{s.open}</span>, '지금 열린 건 전체')}
        {kpi('마감 지남', <span className={s.overdue ? 'text-red-600' : ''}>{s.overdue}</span>, '처리 보고 전')}
        {kpi('미확인 24시간 초과', <span className={s.unread_24h ? 'text-amber-600' : ''}>{s.unread_24h}</span>)}
        {kpi('평균 처리', s.avg_hours_to_report === null ? '-' : s.avg_hours_to_report < 48 ? `${s.avg_hours_to_report}시간` : `${(s.avg_hours_to_report / 24).toFixed(1)}일`, '요청 → 처리 보고 (이달 보고분)')}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-2">직원별</h2>
          {employees.length === 0 ? <p className="text-xs text-gray-400 py-4">요청이 없습니다.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">직원</th><th className="py-1.5 font-medium">팀</th><th className="py-1.5 font-medium text-right">받은</th><th className="py-1.5 font-medium text-right">진행 중</th><th className="py-1.5 font-medium text-right">지남</th><th className="py-1.5 font-medium text-right">완료</th><th className="py-1.5 font-medium text-right">보낸</th></tr></thead>
              <tbody>{employees.map(e => (
                <tr key={e.id} onClick={() => setEmp(emp === e.id ? null : e.id)} className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${emp === e.id ? 'bg-slate-50' : ''}`}>
                  <td className="py-1.5 font-semibold text-gray-900">{e.name}</td><td className="py-1.5 text-xs text-gray-500">{e.team ?? '-'}</td>
                  <td className="py-1.5 text-right tabular-nums">{e.received}</td><td className="py-1.5 text-right tabular-nums text-blue-700">{e.open || <span className="text-gray-300">-</span>}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-600">{e.overdue || <span className="text-gray-300">-</span>}</td><td className="py-1.5 text-right tabular-nums">{e.completed}</td><td className="py-1.5 text-right tabular-nums">{e.sent}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-2">지금 신경 쓸 것</h2>
          {data.attention.length === 0 ? <p className="text-xs text-gray-400 py-4">마감 지남 · 미확인 24시간 초과 건이 없습니다.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">요청</th><th className="py-1.5 font-medium">담당</th><th className="py-1.5 font-medium">마감</th><th className="py-1.5 font-medium">상태</th></tr></thead>
              <tbody>{data.attention.slice(0, 15).map(r => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-1.5 max-w-[260px] truncate"><Link href={`/me/requests/${r.id}`} className="hover:underline">{r.is_urgent && <span className="text-[10px] px-1 rounded bg-red-600 text-white mr-1">긴급</span>}{r.title}</Link></td>
                  <td className="py-1.5 text-gray-700 whitespace-nowrap">{r.assignee?.name}</td>
                  <td className="py-1.5 text-xs tabular-nums whitespace-nowrap text-red-600">{fmtDue(r.due_at)}</td>
                  <td className="py-1.5"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${r.reason === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.reason === 'overdue' ? '지남' : '미확인 24h+'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-bold text-gray-900">전체 목록 <span className="text-xs text-gray-400 font-normal">{rows.length}건{empName ? ` · ${empName}` : ''}</span></div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200"><th className="py-2 px-3 font-medium"></th><th className="py-2 px-3 font-medium">요청</th><th className="py-2 px-3 font-medium">요청자</th><th className="py-2 px-3 font-medium">담당자</th><th className="py-2 px-3 font-medium">요청일</th><th className="py-2 px-3 font-medium">마감</th><th className="py-2 px-3 font-medium">상태</th><th className="py-2 px-3 font-medium">최근 메모</th></tr></thead>
          <tbody>{rows.map(r => { const ds = dueState(r); return (
            <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 px-3">{r.is_urgent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold">긴급</span>}</td>
              <td className="py-2 px-3 max-w-[360px] truncate"><Link href={`/me/requests/${r.id}`} className="font-medium text-gray-900 hover:underline">{r.title}</Link></td>
              <td className="py-2 px-3 whitespace-nowrap text-gray-700">{r.requester?.name}</td><td className="py-2 px-3 whitespace-nowrap text-gray-700">{r.assignee?.name}</td>
              <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-500 tabular-nums">{fmtDT(r.created_at)}</td>
              <td className={`py-2 px-3 whitespace-nowrap tabular-nums ${ds === 'overdue' ? 'text-red-600 font-medium' : ds === 'today' ? 'text-amber-600' : 'text-gray-700'}`}>{fmtDue(r.due_at)}</td>
              <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap ${WR_STATUS_CLS[r.status]}`}>{WR_STATUS_LABEL[r.status]}</span></td>
              <td className="py-2 px-3 text-xs text-gray-500 max-w-[280px] truncate">{r.last_memo ?? (OPEN_STATUSES.includes(r.status) ? '-' : '')}</td>
            </tr>
          ) })}</tbody>
        </table>
        {rows.length === 0 && <p className="text-center py-10 text-gray-400 text-sm">표시할 요청이 없습니다.</p>}
      </div>
    </div>
  )
}
