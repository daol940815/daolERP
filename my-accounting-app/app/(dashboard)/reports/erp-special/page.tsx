'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ErpSpecialData } from '@/lib/erp-special'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

type Tab = 'vip' | 'prepayment'

const EMPTY: ErpSpecialData = { vip_items: [], prepay_items: [], ledger: [], balances: [] }

export default function ErpSpecialPage() {
  const [data, setData]         = useState<ErpSpecialData>(EMPTY)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<Tab>('vip')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [msg, setMsg]           = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const res  = await fetch(`/api/reports/erp-special?${p}`)
    const json = await res.json()
    if (res.ok) setData(json)
    else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const handleExport = () => {
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const a = document.createElement('a')
    a.href = `/api/reports/erp-special/export?${p}`
    a.click()
  }

  const vipTotal      = data.vip_items.filter(r => !r.is_canceled).reduce((s, r) => s + r.line_total, 0)
  const depositTotal  = data.balances.reduce((s, r) => s + r.deposit_total, 0)
  const deductTotal   = data.balances.reduce((s, r) => s + r.deduction_total, 0)
  const balanceTotal  = data.balances.reduce((s, r) => s + r.balance, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ERP VIP·선결제 내역</h1>
          <p className="text-sm mt-1 text-blue-700 font-medium">매출/매입 집계에서 제외된 VIP 품목과 매출처 선결제 원장·잔액</p>
        </div>
        <button
          onClick={handleExport}
          disabled={loading}
          className="px-3 py-2 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1.5"
        >
          ↓ 엑셀 다운로드
        </button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 탭 */}
      <div className="flex items-center gap-1 mb-3 mt-3 border-b border-gray-200">
        {([['vip', 'VIP 품목'], ['prepayment', '선결제']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'
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
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : tab === 'vip' ? (
        <>
          {/* VIP 요약 */}
          <div className="flex gap-3 flex-wrap mb-5">
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">VIP 금액 합계 (취소 제외)</p>
              <p className="text-lg font-bold text-violet-600">{won(vipTotal)}</p>
              <p className="text-xs text-gray-400">{data.vip_items.length}건</p>
            </div>
          </div>

          {data.vip_items.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-sm">VIP 품목이 없습니다.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">주문일</th>
                    <th className="py-2.5 px-3 font-medium">주문번호</th>
                    <th className="py-2.5 px-3 font-medium">매출처</th>
                    <th className="py-2.5 px-3 font-medium">품명</th>
                    <th className="py-2.5 px-3 font-medium text-right">판매가</th>
                    <th className="py-2.5 px-3 font-medium text-right">수량</th>
                    <th className="py-2.5 px-3 font-medium text-right">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vip_items.map(r => (
                    <tr key={r.id} className={`border-b border-gray-100 hover:bg-gray-50 ${r.is_canceled ? 'text-gray-400' : ''}`}>
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600">{r.order_date ?? '-'}</td>
                      <td className="py-2 px-3 whitespace-nowrap font-mono text-xs">
                        {r.order_no}
                        {r.is_canceled && <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500 font-sans">취소</span>}
                      </td>
                      <td className="py-2 px-3"><p className="truncate max-w-[200px]">{r.customer_name}</p></td>
                      <td className="py-2 px-3"><p className="truncate max-w-[240px]">{r.item_name ?? '-'}</p></td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.sale_price)}</td>
                      <td className="py-2 px-3 text-right">{r.quantity}</td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${r.is_canceled ? 'line-through' : 'text-violet-600'}`}>{won(r.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-medium text-gray-900">
                    <td className="py-2.5 px-3" colSpan={6}>합계 (취소 제외)</td>
                    <td className="py-2.5 px-3 text-right text-violet-700 whitespace-nowrap">{won(vipTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {/* 선결제 요약 */}
          <div className="flex gap-3 flex-wrap mb-5">
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">입금 합계 (전체 기간)</p>
              <p className="text-lg font-bold text-gray-900">{won(depositTotal)}</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">차감 합계 (전체 기간)</p>
              <p className="text-lg font-bold text-gray-900">{won(deductTotal)}</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">선결제 잔액 합계</p>
              <p className="text-lg font-bold text-sky-600">{won(balanceTotal)}</p>
            </div>
          </div>

          {/* 매출처별 잔액 */}
          <h2 className="text-sm font-semibold text-gray-700 mb-2">매출처별 선결제 잔액</h2>
          {data.balances.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm border border-gray-200 rounded-xl mb-6">선결제 내역이 없습니다.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">매출처</th>
                    <th className="py-2.5 px-3 font-medium text-right">입금 합계</th>
                    <th className="py-2.5 px-3 font-medium text-right">차감 합계</th>
                    <th className="py-2.5 px-3 font-medium text-right">잔액</th>
                  </tr>
                </thead>
                <tbody>
                  {data.balances.map(r => (
                    <tr key={r.alias_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3"><p className="truncate max-w-[260px]">{r.customer_name}</p></td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.deposit_total)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.deduction_total)}</td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${r.balance > 0 ? 'text-sky-600' : r.balance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {won(r.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 원장 */}
          <h2 className="text-sm font-semibold text-gray-700 mb-2">선결제 원장 (입금·차감 내역)</h2>
          {data.ledger.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm border border-gray-200 rounded-xl">선택한 기간에 입금/차감 내역이 없습니다.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">일자</th>
                    <th className="py-2.5 px-3 font-medium">매출처</th>
                    <th className="py-2.5 px-3 font-medium">구분</th>
                    <th className="py-2.5 px-3 font-medium text-right">금액</th>
                    <th className="py-2.5 px-3 font-medium">메모</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map(r => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600">{r.entry_date}</td>
                      <td className="py-2 px-3"><p className="truncate max-w-[220px]">{r.customer_name}</p></td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${r.entry_type === 'deposit' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                          {r.entry_type === 'deposit' ? '입금' : '차감'}
                        </span>
                      </td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap ${r.entry_type === 'deposit' ? 'text-sky-600' : 'text-amber-700'}`}>
                        {r.entry_type === 'deposit' ? '+' : '−'}{won(r.amount)}
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500"><p className="truncate max-w-[320px]">{r.memo ?? '-'}</p></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
