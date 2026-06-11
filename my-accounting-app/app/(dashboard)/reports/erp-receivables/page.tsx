'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ErpReceivableRow } from '@/types/erp'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

interface Vendor { id: string; name: string }

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

export default function ErpReceivablesPage() {
  const [rows, setRows]         = useState<ErpReceivableRow[]>([])
  const [vendors, setVendors]   = useState<Vendor[]>([])
  const [loading, setLoading]   = useState(true)
  const [exporting, setExporting] = useState(false)
  const [search, setSearch]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [staff, setStaff]       = useState('')
  const [staffNames, setStaffNames] = useState<string[]>([])
  const [msg, setMsg]           = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    if (staff)    p.set('staff', staff)
    const res  = await fetch(`/api/reports/erp-receivables?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) {
      setRows(json.data)
      if (Array.isArray(json.staff_names)) setStaffNames(json.staff_names)
    } else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [dateFrom, dateTo, staff])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/vendors?all=true')
      .then(r => r.json())
      .then(d => { if (d.data) setVendors(d.data) })
      .catch(() => null)
  }, [])

  const handleExport = useCallback(() => {
    setExporting(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    if (staff)    p.set('staff', staff)
    const a = document.createElement('a')
    a.href = `/api/reports/erp-receivables/export?${p}`
    a.click()
    setExporting(false)
  }, [dateFrom, dateTo, staff])

  const handleLinkVendor = async (row: ErpReceivableRow, vendorId: string) => {
    if (!row.alias_id) return
    const res  = await fetch('/api/erp-aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.alias_id, vendor_id: vendorId || null }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`연결 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    const vendorName = vendors.find(v => v.id === vendorId)?.name ?? null
    setRows(prev => prev.map(r => r.alias_id === row.alias_id
      ? { ...r, vendor_id: vendorId || null, vendor_name: vendorName }
      : r))
    showMsg(vendorId ? '거래처 연결 완료 (이후 업로드에도 자동 적용)' : '거래처 연결 해제')
  }

  const q = search.trim()
  const filtered = q
    ? rows.filter(r => r.erp_name.includes(q) || (r.vendor_name ?? '').includes(q))
    : rows

  const totalSales   = filtered.reduce((s, r) => s + r.total_amount, 0)
  const totalOut     = filtered.reduce((s, r) => s + r.outstanding_amount, 0)
  const totalPrepay  = filtered.reduce((s, r) => s + r.prepay_balance, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ERP 매출처별 미수금현황</h1>
          <p className="text-sm mt-1 text-blue-700 font-medium">ERP 주문 기준 매출처(은행·지점)별 수금/미수금 현황 · 취소/VIP/선결제 제외</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading || filtered.length === 0}
          className="px-3 py-2 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1.5"
        >
          ↓ {exporting ? '다운로드 중...' : '엑셀 다운로드'}
        </button>
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
        <select
          value={staff}
          onChange={e => setStaff(e.target.value)}
          className={`border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 ${staff ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'}`}
        >
          <option value="">담당직원 전체</option>
          {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
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
          <p className="text-xs text-gray-400 mb-1">미수금 합계</p>
          <p className={`text-lg font-bold ${totalOut > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(totalOut)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">선결제 잔액 합계</p>
          <p className="text-lg font-bold text-sky-600">{won(totalPrepay)}</p>
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
                <th className="py-2.5 px-3 font-medium">담당직원</th>
                <th className="py-2.5 px-3 font-medium text-right">주문</th>
                <th className="py-2.5 px-3 font-medium text-right">순매출</th>
                <th className="py-2.5 px-3 font-medium text-right">VIP·선결제</th>
                <th className="py-2.5 px-3 font-medium text-right">미수금</th>
                <th className="py-2.5 px-3 font-medium text-right">선결제 잔액</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.alias_id ?? 'none'} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 min-w-0">
                    <p className="truncate max-w-[220px] text-gray-900">{r.erp_name}</p>
                  </td>
                  <td className="py-2 px-3">
                    {r.alias_id ? (
                      <select
                        value={r.vendor_id ?? ''}
                        onChange={e => handleLinkVendor(r, e.target.value)}
                        className={`border rounded px-2 py-1 text-xs w-44 ${r.vendor_id ? 'border-gray-200 text-gray-700' : 'border-amber-300 text-amber-600 bg-amber-50'}`}
                      >
                        <option value="">미연결</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    ) : <span className="text-xs text-gray-400">-</span>}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-600">
                    <p className="truncate max-w-[120px]">{r.staff_names.length ? r.staff_names.join(', ') : '-'}</p>
                  </td>
                  <td className="py-2 px-3 text-right text-gray-500 whitespace-nowrap">{r.order_count}건</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.total_amount)}</td>
                  <td className="py-2 px-3 text-right text-violet-500 whitespace-nowrap">{r.excluded_amount ? won(r.excluded_amount) : '-'}</td>
                  <td className={`py-2 px-3 text-right font-medium whitespace-nowrap ${r.outstanding_amount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {won(r.outstanding_amount)}
                    {r.outstanding_count > 0 && <span className="text-xs text-gray-400 ml-1">({r.outstanding_count}건)</span>}
                  </td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${r.prepay_balance > 0 ? 'text-sky-600' : 'text-gray-400'}`}>
                    {won(r.prepay_balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-medium text-gray-900">
                <td className="py-2.5 px-3" colSpan={4}>합계</td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(totalSales)}</td>
                <td className="py-2.5 px-3 text-right text-violet-600 whitespace-nowrap">{won(filtered.reduce((s, r) => s + r.excluded_amount, 0))}</td>
                <td className="py-2.5 px-3 text-right text-red-700 whitespace-nowrap">{won(totalOut)}</td>
                <td className="py-2.5 px-3 text-right text-sky-700 whitespace-nowrap">{won(totalPrepay)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
