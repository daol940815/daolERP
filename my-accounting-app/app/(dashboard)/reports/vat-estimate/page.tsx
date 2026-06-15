'use client'

import { useCallback, useEffect, useState } from 'react'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface VatBreakdownItem {
  label: string
  amount: number
}

interface VatEstimateResult {
  from: string
  to: string
  sales_tax: number
  purchase_tax: number
  estimated_vat: number
  sales_breakdown: VatBreakdownItem[]
  purchase_breakdown: VatBreakdownItem[]
}

export default function VatEstimatePage() {
  const [result, setResult] = useState<VatEstimateResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당분기').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당분기').to)
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    p.set('from', dateFrom)
    p.set('to', dateTo)
    const res  = await fetch(`/api/reports/vat-estimate?${p}`)
    const json = await res.json()
    if (res.ok) setResult(json)
    else { showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`); setResult(null) }
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const vat = result?.estimated_vat ?? 0
  const isRefund = vat < 0

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">예상 부가세</h1>
        <p className="text-sm mt-1 text-gray-500">세금계산서·현금영수증·카드매출 자료를 바탕으로 기간 내 매출세액 대비 매입세액을 추정합니다. (실제 신고액과 차이가 있을 수 있습니다)</p>
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
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : !result ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <>
          {/* 요약 카드 */}
          <div className="flex gap-3 flex-wrap mb-5">
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">매출세액</p>
              <p className="text-lg font-bold text-blue-600">{won(result.sales_tax)}</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">매입세액</p>
              <p className="text-lg font-bold text-rose-600">{won(result.purchase_tax)}</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[200px]">
              <p className="text-xs text-gray-400 mb-1">{isRefund ? '예상 환급액' : '예상 납부액'}</p>
              <p className={`text-lg font-bold ${isRefund ? 'text-emerald-600' : 'text-gray-900'}`}>{won(Math.abs(vat))}</p>
            </div>
          </div>

          {/* 상세 내역 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <p className="px-4 py-2.5 text-sm font-medium text-gray-700 border-b border-gray-200 bg-gray-50">매출세액 구성</p>
              <table className="w-full text-sm">
                <tbody>
                  {result.sales_breakdown.map(b => (
                    <tr key={b.label} className="border-b border-gray-100">
                      <td className="py-2 px-4 text-gray-600">{b.label}</td>
                      <td className="py-2 px-4 text-right whitespace-nowrap">{won(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium text-gray-900">
                    <td className="py-2 px-4">합계</td>
                    <td className="py-2 px-4 text-right whitespace-nowrap text-blue-700">{won(result.sales_tax)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <p className="px-4 py-2.5 text-sm font-medium text-gray-700 border-b border-gray-200 bg-gray-50">매입세액 구성</p>
              <table className="w-full text-sm">
                <tbody>
                  {result.purchase_breakdown.map(b => (
                    <tr key={b.label} className="border-b border-gray-100">
                      <td className="py-2 px-4 text-gray-600">{b.label}</td>
                      <td className="py-2 px-4 text-right whitespace-nowrap">{won(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium text-gray-900">
                    <td className="py-2 px-4">합계</td>
                    <td className="py-2 px-4 text-right whitespace-nowrap text-rose-700">{won(result.purchase_tax)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
