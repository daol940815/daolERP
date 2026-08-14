'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

// 팀 업무 현황 — 직원별 업무 건수를 유형별로 집계. 행 클릭 시 그 직원의 업무일지로 드릴다운.
// "오늘 아무 기록도 없는 직원"이 보여야 하므로 활동 0건인 직원도 행으로 남긴다.

interface Row {
  employee_id: string
  name: string
  position: string | null
  role: string
  counts: Record<string, number>
  total: number
  last_at: string | null
}

interface Data {
  rows: Row[]
  totals: Record<string, number>
  actions: string[]
  period: string
  period_label: string
  from: string
  to: string
  grand_total: number
  active_cnt: number
}

const PERIODS = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번 주' },
  { key: 'month', label: '이번 달' },
]

const lastLabel = (ts: string | null) => {
  if (!ts) return '-'
  const d = new Date(ts)
  const kst = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return kst
}

export default function TeamWorklogClient() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('week')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch(`/api/team/worklog?period=${period}`)
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setData(null) }
    else setData(json)
    setLoading(false)
  }, [period])
  useEffect(() => { load() }, [load])

  const actions = data?.actions ?? []
  const idle = (data?.rows ?? []).filter(r => r.total === 0).length

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">팀 업무 현황</h1>
        <span className="text-xs text-gray-400">직원별 업무 건수 집계 · 이름을 누르면 해당 직원 업무일지로 이동합니다.</span>
        <Link href="/me/worklog"
          className="ml-auto px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          내 업무일지
        </Link>
      </div>

      {error && <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="flex items-center gap-2 mt-4">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`px-3.5 py-1.5 rounded-full text-xs border transition-colors ${
              period === p.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
        {data && <span className="text-xs text-gray-400 ml-1">{data.from} ~ {data.to}</span>}
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
          {[
            { label: `${data.period_label} 전체 업무`, value: `${data.grand_total}건`, sub: null },
            { label: '활동한 직원', value: `${data.active_cnt}명`, sub: `전체 ${data.rows.length}명` },
            { label: '기록 없는 직원', value: `${idle}명`, sub: idle ? '확인 필요' : '전원 기록' },
            { label: '직접 기재', value: `${data.totals['직접기재'] ?? 0}건`, sub: 'ERP 밖 업무' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-gray-200 rounded-xl px-3.5 py-3">
              <div className="text-xs text-gray-500">{k.label}</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{k.value}</div>
              {k.sub && <div className="text-[10.5px] text-gray-400 mt-0.5">{k.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">로딩 중...</div>
      ) : !data ? null : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="px-3.5 py-2.5 text-left font-medium">직원</th>
                  {actions.map(a => <th key={a} className="px-2 py-2.5 text-right font-medium whitespace-nowrap">{a}</th>)}
                  <th className="px-3 py-2.5 text-right font-medium">합계</th>
                  <th className="px-3.5 py-2.5 text-right font-medium whitespace-nowrap">마지막 기록</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.employee_id} className={`border-t border-gray-50 hover:bg-slate-50 ${r.total === 0 ? 'text-gray-400' : ''}`}>
                    <td className="px-3.5 py-2.5">
                      <Link href={`/me/worklog?employee=${r.employee_id}`} className="text-slate-900 hover:underline font-medium">
                        {r.name}
                      </Link>
                      {r.position && <span className="text-xs text-gray-400 ml-1.5">{r.position}</span>}
                    </td>
                    {actions.map(a => (
                      <td key={a} className="px-2 py-2.5 text-right tabular-nums">
                        {r.counts[a] ? r.counts[a] : <span className="text-gray-300">-</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{r.total}</td>
                    <td className="px-3.5 py-2.5 text-right text-xs text-gray-500 whitespace-nowrap">{lastLabel(r.last_at)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-100 bg-gray-50 text-xs font-semibold text-gray-700">
                  <td className="px-3.5 py-2.5">합계</td>
                  {actions.map(a => <td key={a} className="px-2 py-2.5 text-right tabular-nums">{data.totals[a] ?? 0}</td>)}
                  <td className="px-3 py-2.5 text-right tabular-nums">{data.grand_total}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
