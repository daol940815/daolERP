'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReconciliationRow } from '@/lib/vendor-reconciliation'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

type Direction = 'sales' | 'purchase'

export default function VendorReconciliationPage() {
  const [direction, setDirection] = useState<Direction>('sales')
  const [rows, setRows]         = useState<ReconciliationRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [search, setSearch]     = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [msg, setMsg]           = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ direction })
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const res  = await fetch(`/api/reports/vendor-reconciliation?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setRows(json.data)
    else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [direction, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const handleExport = () => {
    const p = new URLSearchParams({ direction })
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const a = document.createElement('a')
    a.href = `/api/reports/vendor-reconciliation/export?${p}`
    a.click()
  }

  const q = search.trim()
  const filtered = rows
    .filter(r => !q || r.vendor_name.includes(q))
    .filter(r => !onlyDiff || r.diff_payment !== 0)

  const isSales = direction === 'sales'
  const totalErp     = filtered.reduce((s, r) => s + r.erp_amount, 0)
  const totalPayment = filtered.reduce((s, r) => s + r.payment_total, 0)
  const totalDiff    = filtered.reduce((s, r) => s + r.diff_payment, 0)

  const diffCls = (n: number) =>
    n === 0 ? 'text-gray-400' : n > 0 ? 'text-red-600' : 'text-blue-600'

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-1 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">거래처 정산 대조</h1>
          <p className="text-sm mt-1 text-blue-700 font-medium">
            ERP {isSales ? '매출' : '매입'} vs 은행 {isSales ? '입금' : '출금'}·{isSales ? '카드매출·' : ''}현금영수증·세금계산서 — 거래처별 차액 확인
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={loading || filtered.length === 0}
          className="px-3 py-2 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1.5"
        >
          ↓ 엑셀 다운로드
        </button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 방향 탭 */}
      <div className="flex items-center gap-1 mb-3 mt-3 border-b border-gray-200">
        {([['sales', '매출 (수금 대조)'], ['purchase', '매입 (결제 대조)']] as [Direction, string][]).map(([d, label]) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              direction === d ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
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
          <button onClick={() => { setDateFrom(''); setDateTo('') }} className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-600">
            ✕ 전체 기간
          </button>
        )}
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
          placeholder="거래처명 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} />
          차액 있는 건만
        </label>
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">ERP {isSales ? '순매출' : '매입'} 합계</p>
          <p className="text-lg font-bold text-gray-900">{won(totalErp)}</p>
          <p className="text-xs text-gray-400">거래처 {filtered.length}곳</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{isSales ? '수금' : '결제'} 합계 (은행{isSales ? '+카드' : ''}+현금영수증)</p>
          <p className="text-lg font-bold text-gray-900">{won(totalPayment)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">차액 합계 (ERP − {isSales ? '수금' : '결제'})</p>
          <p className={`text-lg font-bold ${diffCls(totalDiff)}`}>{won(totalDiff)}</p>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        * ERP는 주문일, 입출금·카드·현금영수증·계산서는 거래일 기준이라 기간 경계에서 시점 차이로 차액이 생길 수 있습니다.
        차액 <span className="text-red-600">+빨강</span>은 ERP보다 {isSales ? '수금' : '결제'}이 부족, <span className="text-blue-600">−파랑</span>은 초과입니다.
      </p>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          표시할 데이터가 없습니다. 별칭 매칭과 거래내역 거래처 연결을 먼저 진행해주세요.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">거래처</th>
                <th className="py-2.5 px-3 font-medium text-right">ERP {isSales ? '순매출' : '매입'}</th>
                {isSales && <th className="py-2.5 px-3 font-medium text-right">ERP 미수금</th>}
                <th className="py-2.5 px-3 font-medium text-right">은행 {isSales ? '입금' : '출금'}</th>
                {isSales && <th className="py-2.5 px-3 font-medium text-right">카드매출</th>}
                <th className="py-2.5 px-3 font-medium text-right">현금영수증</th>
                <th className="py-2.5 px-3 font-medium text-right">{isSales ? '수금' : '결제'} 합계</th>
                <th className="py-2.5 px-3 font-medium text-right">차액</th>
                <th className="py-2.5 px-3 font-medium text-right">세금계산서</th>
                <th className="py-2.5 px-3 font-medium text-right">차액(계산서)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.vendor_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3"><p className="truncate max-w-[200px] text-gray-900">{r.vendor_name}</p></td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.erp_amount)}</td>
                  {isSales && (
                    <td className={`py-2 px-3 text-right whitespace-nowrap ${r.erp_outstanding > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {won(r.erp_outstanding)}
                    </td>
                  )}
                  <td className="py-2 px-3 text-right whitespace-nowrap text-gray-600">{won(r.bank_amount)}</td>
                  {isSales && <td className="py-2 px-3 text-right whitespace-nowrap text-gray-600">{won(r.card_amount)}</td>}
                  <td className="py-2 px-3 text-right whitespace-nowrap text-gray-600">{won(r.cash_amount)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(r.payment_total)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${diffCls(r.diff_payment)}`}>{won(r.diff_payment)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-gray-600">{won(r.invoice_amount)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${diffCls(r.diff_invoice)}`}>{won(r.diff_invoice)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-medium text-gray-900">
                <td className="py-2.5 px-3">합계</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(totalErp)}</td>
                {isSales && <td className="py-2.5 px-3 text-right whitespace-nowrap text-red-700">{won(filtered.reduce((s, r) => s + r.erp_outstanding, 0))}</td>}
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(filtered.reduce((s, r) => s + r.bank_amount, 0))}</td>
                {isSales && <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(filtered.reduce((s, r) => s + r.card_amount, 0))}</td>}
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(filtered.reduce((s, r) => s + r.cash_amount, 0))}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(totalPayment)}</td>
                <td className={`py-2.5 px-3 text-right whitespace-nowrap ${diffCls(totalDiff)}`}>{won(totalDiff)}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(filtered.reduce((s, r) => s + r.invoice_amount, 0))}</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(filtered.reduce((s, r) => s + r.diff_invoice, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
