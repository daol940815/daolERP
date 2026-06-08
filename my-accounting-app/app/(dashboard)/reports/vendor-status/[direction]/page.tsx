'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { VendorStatusRow } from '@/types/report'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const DIRECTION_META: Record<string, {
  title: string; sub: string; color: string
  billedLabel: string; doneLabel: string; remainingLabel: string; actionLabel: string
}> = {
  sales: {
    title: '매출처별 수금현황',
    sub: '거래처별 매출 세금계산서 발행 대비 수금 현황',
    color: 'text-blue-700',
    billedLabel: '청구 합계',
    doneLabel: '수금 완료',
    remainingLabel: '미수금 잔액',
    actionLabel: '수금',
  },
  purchase: {
    title: '매입처별 대금결제현황',
    sub: '거래처별 매입 세금계산서 수취 대비 결제 현황',
    color: 'text-orange-700',
    billedLabel: '청구 합계',
    doneLabel: '지급 완료',
    remainingLabel: '미지급 잔액',
    actionLabel: '결제',
  },
}

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

export default function VendorStatusReportPage() {
  const params    = useParams<{ direction: string }>()
  const direction = params.direction
  const valid     = direction === 'sales' || direction === 'purchase'

  const [rows, setRows]       = useState<VendorStatusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  const load = useCallback(async () => {
    if (!valid) return
    setLoading(true)
    const p = new URLSearchParams({ direction })
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const res  = await fetch(`/api/reports/vendor-status?${p.toString()}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setRows(json.data)
    setLoading(false)
  }, [valid, direction, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  if (!valid) {
    return <div className="text-center py-20 text-gray-400 text-sm">잘못된 경로입니다.</div>
  }

  const meta = DIRECTION_META[direction]
  const q    = search.trim()
  const filtered = q
    ? rows.filter(r => r.vendor_name.includes(q) || (r.biz_number ?? '').includes(q))
    : rows

  const totalBilled   = filtered.reduce((s, r) => s + r.total_amount, 0)
  const totalDone     = filtered.reduce((s, r) => s + r.matched_amount, 0)
  const totalRemain   = filtered.reduce((s, r) => s + r.remaining, 0)
  const totalCount    = filtered.reduce((s, r) => s + r.count, 0)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{meta.title}</h1>
        <p className={`text-sm mt-1 ${meta.color} font-medium`}>{meta.sub}</p>
      </div>

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2 mt-3">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          >
            {p}
          </button>
        ))}
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo('') }}
            className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-600"
          >
            ✕ 전체 기간
          </button>
        )}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <span className="text-gray-400 text-sm">~</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처명 또는 사업자번호 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{meta.billedLabel}</p>
          <p className="text-lg font-bold text-gray-900">{won(totalBilled)}</p>
          <p className="text-xs text-gray-400">{totalCount}건 · 거래처 {filtered.length}곳</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{meta.doneLabel}</p>
          <p className="text-lg font-bold text-green-600">{won(totalDone)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{meta.remainingLabel}</p>
          <p className={`text-lg font-bold ${totalRemain > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(totalRemain)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">거래처</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{meta.billedLabel}</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{meta.doneLabel}</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">{meta.remainingLabel}</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">건수</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.vendor_id ?? 'unassigned'} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2.5 px-3 min-w-0">
                    <p className={`truncate max-w-[220px] ${r.vendor_id ? 'text-gray-900' : 'text-gray-400 italic'}`}>{r.vendor_name}</p>
                    {r.biz_number && <p className="text-xs text-gray-400">{r.biz_number}</p>}
                  </td>
                  <td className="py-2.5 px-3 text-right text-gray-600 whitespace-nowrap">{won(r.total_amount)}</td>
                  <td className="py-2.5 px-3 text-right text-green-600 whitespace-nowrap">{won(r.matched_amount)}</td>
                  <td className={`py-2.5 px-3 text-right font-medium whitespace-nowrap ${r.remaining > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {won(r.remaining)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-gray-400 whitespace-nowrap">
                    {r.count}건 <span className="text-xs">({r.matched_count}건 {meta.actionLabel})</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-medium text-gray-900">
                <td className="py-2.5 px-3">합계</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(totalBilled)}</td>
                <td className="py-2.5 px-3 text-right text-green-700 whitespace-nowrap">{won(totalDone)}</td>
                <td className="py-2.5 px-3 text-right text-red-700 whitespace-nowrap">{won(totalRemain)}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{totalCount}건</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
