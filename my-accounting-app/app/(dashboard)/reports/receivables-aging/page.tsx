'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ErpAgingRow, AgingBuckets } from '@/types/erp'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

const emptyTotal: AgingBuckets = { bucket_30: 0, bucket_60: 0, bucket_90: 0, bucket_over: 0, total: 0 }

export default function ReceivablesAgingPage() {
  const [rows, setRows]   = useState<ErpAgingRow[]>([])
  const [total, setTotal] = useState<AgingBuckets>(emptyTotal)
  const [asOf, setAsOf]   = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (asOf) p.set('asOf', asOf)
    const res  = await fetch(`/api/reports/receivables-aging?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) {
      setRows(json.data)
      setTotal(json.total ?? emptyTotal)
    } else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [asOf])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">미수금 Aging 분석</h1>
          <p className="text-sm mt-1 text-gray-500">매출처별 미수금을 발생일(주문일) 기준 경과기간 구간별로 분석합니다.</p>
        </div>
        <button onClick={() => { const a = document.createElement('a'); a.href = `/api/reports/receivables-aging/export?asOf=${asOf}`; a.click() }}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap">↓ 엑셀</button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기준일 */}
      <div className="flex items-center gap-2 mb-4 mt-3 flex-wrap">
        <span className="text-sm text-gray-500">기준일</span>
        <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">30일 이내</p>
          <p className="text-lg font-bold text-gray-900">{won(total.bucket_30)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">31~60일</p>
          <p className="text-lg font-bold text-amber-600">{won(total.bucket_60)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">61~90일</p>
          <p className="text-lg font-bold text-orange-600">{won(total.bucket_90)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">90일 초과</p>
          <p className="text-lg font-bold text-red-600">{won(total.bucket_over)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">미수금 총계</p>
          <p className="text-lg font-bold text-gray-900">{won(total.total)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">미수금이 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">매출처 (ERP)</th>
                <th className="py-2.5 px-3 font-medium">연결 거래처</th>
                <th className="py-2.5 px-3 font-medium text-right">30일 이내</th>
                <th className="py-2.5 px-3 font-medium text-right">31~60일</th>
                <th className="py-2.5 px-3 font-medium text-right">61~90일</th>
                <th className="py-2.5 px-3 font-medium text-right">90일 초과</th>
                <th className="py-2.5 px-3 font-medium text-right">합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.alias_id ?? 'none'} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 min-w-0">
                    <p className="truncate max-w-[220px] text-gray-900">{r.erp_name}</p>
                  </td>
                  <td className="py-2 px-3 text-gray-600">{r.vendor_name ?? '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-gray-700">{won(r.bucket_30)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-amber-600">{won(r.bucket_60)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-orange-600">{won(r.bucket_90)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-red-600">{won(r.bucket_over)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-medium text-gray-900">
                <td className="py-2.5 px-3" colSpan={2}>합계</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(total.bucket_30)}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap text-amber-700">{won(total.bucket_60)}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap text-orange-700">{won(total.bucket_90)}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap text-red-700">{won(total.bucket_over)}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(total.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
