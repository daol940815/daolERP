'use client'

import { useCallback, useEffect, useState } from 'react'
import type { VendorAnalysisRow } from '@/types/erp'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`
const num = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}`

export default function VendorSalesPage() {
  const [rows, setRows]   = useState<VendorAnalysisRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당월').to)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const res  = await fetch(`/api/reports/vendor-sales?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setRows(json.data)
    else { showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`); setRows([]) }
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const q = search.trim()
  const filtered = q
    ? rows.filter(r => r.erp_name.includes(q) || (r.vendor_name ?? '').includes(q))
    : rows

  const totalOrders = filtered.reduce((s, r) => s + r.order_count, 0)
  const totalQty    = filtered.reduce((s, r) => s + r.quantity, 0)
  const totalSales  = filtered.reduce((s, r) => s + r.sales_amount, 0)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">거래처별 매출 분석</h1>
        <p className="text-sm mt-1 text-gray-500">매출처(은행·지점)별 기간 내 순매출과 주문/수량 현황을 확인합니다. (취소/VIP/선결제 제외)</p>
        <button onClick={() => { const a = document.createElement('a'); a.href = `/api/reports/vendor-sales/export?from=${dateFrom}&to=${dateTo}`; a.click() }}
          className="mt-2 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap inline-block">↓ 엑셀</button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

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
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="매출처명 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">순매출 합계</p>
          <p className="text-lg font-bold text-gray-900">{won(totalSales)}</p>
          <p className="text-xs text-gray-400">매출처 {filtered.length}곳</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">주문 건수</p>
          <p className="text-lg font-bold text-blue-600">{num(totalOrders)}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">판매 수량</p>
          <p className="text-lg font-bold text-gray-900">{num(totalQty)}개</p>
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
                <th className="py-2.5 px-3 font-medium">매출처 (ERP)</th>
                <th className="py-2.5 px-3 font-medium">연결 거래처</th>
                <th className="py-2.5 px-3 font-medium text-right">주문건수</th>
                <th className="py-2.5 px-3 font-medium text-right">수량</th>
                <th className="py-2.5 px-3 font-medium text-right">순매출</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.alias_id ?? 'none'} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 min-w-0">
                    <p className="truncate max-w-[220px] text-gray-900">{r.erp_name}</p>
                  </td>
                  <td className="py-2 px-3 text-gray-600">{r.vendor_name ?? '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-gray-500">{num(r.order_count)}건</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-gray-500">{num(r.quantity)}개</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(r.sales_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-medium text-gray-900">
                <td className="py-2.5 px-3" colSpan={2}>합계</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{num(totalOrders)}건</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{num(totalQty)}개</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(totalSales)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
