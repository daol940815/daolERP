'use client'

import { useCallback, useEffect, useState } from 'react'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface PLLineItem {
  key: string
  label: string
  is_placeholder: boolean
  is_subtotal: boolean
  is_section_header: boolean
  values: number[]
}

interface MonthlyPLResult {
  months: string[]
  items: PLLineItem[]
}

const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

const formatMonth = (m: string) => {
  const [y, mm] = m.split('-')
  return `${y}.${mm}`
}

export default function MonthlyPLPage() {
  const [result, setResult] = useState<MonthlyPLResult | null>(null)
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const [monthFrom, setMonthFrom] = useState(() => monthStr(new Date(now.getFullYear(), now.getMonth() - 5, 1)))
  const [monthTo, setMonthTo]     = useState(() => monthStr(now))
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    p.set('from', monthFrom)
    p.set('to', monthTo)
    const res  = await fetch(`/api/reports/monthly-pl?${p}`)
    const json = await res.json()
    if (res.ok) setResult(json)
    else { showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`); setResult(null) }
    setLoading(false)
  }, [monthFrom, monthTo])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">월별 손익현황 (경영관리용)</h1>
        <p className="text-sm mt-1 text-gray-500">
          매출·매출원가는 ERP 기준, 나머지 수익·비용은 확정된 분개(세금계산서·법인카드·통장) 기준으로 집계합니다.
          매입성 계정(매출원가·상품매입 분개)은 ERP 원가가 대신하므로 중복 표시하지 않습니다.
        </p>
        <button onClick={() => { const a = document.createElement('a'); a.href = `/api/reports/monthly-pl/export?from=${monthFrom}&to=${monthTo}`; a.click() }}
          className="mt-2 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap inline-block">↓ 엑셀</button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 mt-3 flex-wrap">
        <input type="month" value={monthFrom} onChange={e => setMonthFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="month" value={monthTo} onChange={e => setMonthTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : !result || result.months.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium sticky left-0 bg-white">항목</th>
                {result.months.map(m => (
                  <th key={m} className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{formatMonth(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.items.map(item => item.is_section_header ? (
                <tr key={item.key} className="border-b border-gray-200 bg-slate-100">
                  <td className="py-1.5 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky left-0 bg-slate-100">
                    {item.label}
                  </td>
                  {result.months.map(m => <td key={m} className="bg-slate-100" />)}
                </tr>
              ) : (
                <tr
                  key={item.key}
                  className={`border-b border-gray-100 ${item.is_subtotal ? 'bg-slate-50 font-medium text-gray-900' : 'text-gray-700'}`}
                >
                  <td className="py-2 px-3 whitespace-nowrap sticky left-0 bg-inherit">{item.label}</td>
                  {item.values.map((v, i) => (
                    <td
                      key={result.months[i]}
                      className={`py-2 px-3 text-right whitespace-nowrap ${
                        item.is_placeholder
                          ? 'text-gray-300 italic'
                          : item.is_subtotal && v < 0
                            ? 'text-red-600'
                            : ''
                      }`}
                    >
                      {item.is_placeholder ? '미반영' : won(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
