'use client'

// 업무 요청 현황 — 경영 현황(조회 전용). 통계 중심(2026-11-02): 월 요약 KPI · 직원별 집계 · 지금 신경 쓸 것.
// 목록은 내 업무 › 업무 요청(공용)으로 드릴다운한다 — KPI·직원 행을 누르면 그 조건의 목록으로 이동.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { kstParts, fmtDue, assigneeSummary, type WrRow } from '@/lib/work-requests'

interface Overview {
  summary: { month: string; created: number; completed: number; canceled: number; rejected: number; open: number; overdue: number; unread_24h: number; avg_hours_to_report: number | null }
  employees: { id: string; name: string; team: string | null; received: number; open: number; overdue: number; completed: number; sent: number }[]
  attention: (WrRow & { reason: 'overdue' | 'unread' })[]
  rows: WrRow[]
}

export default function WorkRequestsOverviewPage() {
  const router = useRouter()
  const [month, setMonth] = useState(() => kstParts(new Date()).date.slice(0, 7))
  const [team, setTeam] = useState('')
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
  const listHref = (extra: Record<string, string> = {}) => { const p = new URLSearchParams({ tab: 'all', month, ...extra }); return `/me/requests?${p}` }

  if (err) return <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{err}</div>
  if (!data) return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  const s = data.summary
  const kpi = (k: string, v: React.ReactNode, href: string, sub?: string) => (
    <Link href={href} className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 hover:border-slate-400 transition-colors">
      <p className="text-xs text-gray-500">{k}</p><p className="text-lg font-bold mt-0.5 tabular-nums">{v}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </Link>
  )

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">업무 요청 현황</h1>
        <Link href={listHref()} className="ml-auto px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">전체 목록 보기 →</Link>
      </div>
      <p className="text-sm mt-1 text-gray-500">직원별 업무 요청 진행 상태 요약. 숫자나 직원을 누르면 업무 요청 목록(전체)으로 이동합니다. 조회 전용이며 평가 지표로 쓰지 않습니다.</p>
      <div className="flex items-center gap-2 flex-wrap mt-3 mb-4">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={team} onChange={e => setTeam(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">팀: 전체</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {kpi('이달 요청', s.created, listHref(), `완료 ${s.completed} · 취소 ${s.canceled} · 반려 ${s.rejected}`)}
        {kpi('진행 중', <span className="text-blue-700">{s.open}</span>, listHref({ filter: 'open' }), '지금 열린 건 전체')}
        {kpi('마감 지남', <span className={s.overdue ? 'text-red-600' : ''}>{s.overdue}</span>, listHref({ filter: 'overdue' }), '처리 보고 전')}
        {kpi('미확인 24시간 초과', <span className={s.unread_24h ? 'text-amber-600' : ''}>{s.unread_24h}</span>, listHref({ filter: 'unread' }))}
        {kpi('평균 처리', s.avg_hours_to_report === null ? '-' : s.avg_hours_to_report < 48 ? `${s.avg_hours_to_report}시간` : `${(s.avg_hours_to_report / 24).toFixed(1)}일`, listHref(), '요청 → 처리 보고 (이달 보고분)')}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-2">직원별 <span className="text-xs text-gray-400 font-normal">행을 누르면 그 직원 관련 목록</span></h2>
          {employees.length === 0 ? <p className="text-xs text-gray-400 py-4">요청이 없습니다.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">직원</th><th className="py-1.5 font-medium">팀</th><th className="py-1.5 font-medium text-right" title="담당자 행 기준 — 공동 요청 1건은 담당자마다 1건, 선착에서 해제된 사람은 제외">받은</th><th className="py-1.5 font-medium text-right">진행 중</th><th className="py-1.5 font-medium text-right">지남</th><th className="py-1.5 font-medium text-right">완료</th><th className="py-1.5 font-medium text-right">보낸</th></tr></thead>
              <tbody>{employees.map(e => (
                <tr key={e.id} onClick={() => router.push(listHref({ employee: e.id }))} className="border-b border-gray-50 cursor-pointer hover:bg-gray-50">
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
                  <td className="py-1.5 text-gray-700 whitespace-nowrap">{assigneeSummary(r).main}{assigneeSummary(r).sub && r.assignees.length > 1 && <span className="text-xs text-gray-400 ml-1">{assigneeSummary(r).sub}</span>}</td>
                  <td className="py-1.5 text-xs tabular-nums whitespace-nowrap text-red-600">{fmtDue(r.due_at)}</td>
                  <td className="py-1.5"><span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${r.reason === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.reason === 'overdue' ? '지남' : '미확인 24h+'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="text-xs text-gray-400 mt-3">비공개 요청은 집계에는 포함되지만 승인권자가 아니면 제목이 가려집니다.</p>
        </div>
      </div>
    </div>
  )
}
