'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardSale, CardSaleTransactionType } from '@/types/card-sale'
import type { Vendor } from '@/types/tax-invoice'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

const TYPE_META: Record<CardSaleTransactionType, { label: string; cls: string }> = {
  approval: { label: '승인', cls: 'bg-blue-100 text-blue-700' },
  cancel:   { label: '취소', cls: 'bg-red-100 text-red-700' },
}

export default function CardSalesPage() {
  const [sales, setSales]     = useState<CardSale[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  const [typeFilter, setTypeFilter]   = useState<'all' | CardSaleTransactionType>('all')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [toast, setToast]         = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (typeFilter !== 'all')        params.set('type', typeFilter)
    if (vendorFilter)                params.set('vendorId', vendorFilter)
    if (matchFilter === 'unmatched') params.set('unmatched', 'true')
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to', dateTo)

    const res  = await fetch(`/api/card-sales?${params.toString()}`)
    const json = await res.json()
    if (Array.isArray(json.data)) {
      const rows: CardSale[] = matchFilter === 'matched' ? json.data.filter((r: CardSale) => r.vendor_id) : json.data
      setSales(rows)
    }
    setSelected(new Set())
    setLoading(false)
  }, [typeFilter, matchFilter, vendorFilter, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/vendors?all=true')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setVendors(d.data) })
      .catch(() => null)
  }, [])

  const handleUpload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const res  = await fetch('/api/card-sales/import', { method: 'POST', body: fd })
    const json = await res.json()
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!res.ok) { showMsg(`업로드 실패: ${json.error ?? '알 수 없는 오류'}`); return }

    let msg = `${json.imported}건 저장`
    if (json.skipped) msg += ` · 건너뜀 ${json.skipped}건`
    showMsg(msg)
    load()
  }

  const handleAssignVendor = async (row: CardSale, vendorId: string) => {
    const res  = await fetch(`/api/card-sales/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: vendorId || null }),
    })
    const json = await res.json()
    if (res.ok && json.data) setSales(prev => prev.map(x => x.id === row.id ? json.data : x))
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    setSelected(prev => prev.size === sales.length ? new Set<string>() : new Set(sales.map(s => s.id)))
  }

  const handleBulkDelete = async () => {
    if (!selected.size) return
    if (!window.confirm(`선택한 ${selected.size}건을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return

    setDeleting(true)
    const res  = await fetch('/api/card-sales', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected) }),
    })
    const json = await res.json()
    setDeleting(false)
    if (!res.ok) { showMsg(`삭제 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(`${json.deleted}건 삭제됨`)
    load()
  }

  // ── 요약 통계 ────────────────────────────────────────────────────
  const approvalList = sales.filter(s => s.transaction_type === 'approval')
  const cancelList   = sales.filter(s => s.transaction_type === 'cancel')
  const approvalSum  = approvalList.reduce((s, r) => s + (r.amount || 0), 0)
  const cancelSum    = cancelList.reduce((s, r) => s + (r.amount || 0), 0)
  const netSum       = approvalSum + cancelSum
  const matchedCount = sales.filter(s => s.vendor_id).length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">카드결제내역 (매출)</h1>
          <p className="text-sm mt-1 text-blue-700 font-medium">카드 매출 상세내역 — 정산/입금 현황 확인</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            ↑ {uploading ? '업로드 중...' : '매출 상세내역 업로드'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
          />
        </div>
      </div>

      <div className="mt-3 mb-5 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500">
        PG/카드사에서 다운로드한 카드 매출 상세내역 파일을 그대로 업로드하세요.
        승인번호·거래유형 기준으로 중복 없이 저장되며, 거래처에 등록된 카드번호로 자동 매칭됩니다.
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">순 매출 (취소 반영)</p>
          <p className="text-lg font-bold text-gray-900">{won(netSum)}</p>
          <p className="text-xs text-gray-400">{sales.length}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">취소</p>
          <p className={`text-lg font-bold ${cancelList.length ? 'text-red-600' : 'text-gray-400'}`}>{won(cancelSum)}</p>
          <p className="text-xs text-gray-400">{cancelList.length}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">거래처 매칭</p>
          <p className="text-lg font-bold text-gray-900">{matchedCount} <span className="text-sm font-normal text-gray-400">/ {sales.length}건</span></p>
          <p className="text-xs text-gray-400">미매칭 {sales.length - matchedCount}건</p>
        </div>
      </div>

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap gap-1 mb-2">
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
        <select
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
        >
          <option value="">전체 거래처</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="flex gap-1">
          {([
            { key: 'all', label: '전체' },
            { key: 'approval', label: '승인' },
            { key: 'cancel', label: '취소' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setTypeFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                typeFilter === tab.key ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([
            { key: 'all', label: '전체' },
            { key: 'matched', label: '매칭됨' },
            { key: 'unmatched', label: '미매칭' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setMatchFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                matchFilter === tab.key ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <button
            onClick={handleBulkDelete}
            disabled={deleting}
            className="ml-auto px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            선택 {selected.size}건 삭제
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : sales.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">등록된 카드 매출 내역이 없습니다. 매출 상세내역 파일을 업로드해주세요.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium w-8">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === sales.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">거래일시</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">유형</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">카드번호</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">매입사</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">금액</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">처리현황 / 정산상태</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">거래처</th>
              </tr>
            </thead>
            <tbody>
              {sales.map(row => {
                const meta = TYPE_META[row.transaction_type]
                return (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                    <td className="py-2.5 px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-600">
                      <p>{row.tx_date}</p>
                      {row.tx_time && <p className="text-xs text-gray-400">{row.tx_time}</p>}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-600 font-mono text-xs">{row.card_number ?? '-'}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-500">{row.acquirer ?? '-'}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <p className={`font-medium ${row.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{won(row.amount)}</p>
                      <p className="text-xs text-gray-400">공급 {won(row.supply_amount)} · 세액 {won(row.tax_amount)}</p>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">
                      <p>{row.processing_status ?? '-'} {row.settlement_status ? `· ${row.settlement_status}` : ''}</p>
                      {row.deposit_expected_date && <p className="text-gray-400">입금예정 {row.deposit_expected_date}</p>}
                    </td>
                    <td className="py-2.5 px-3">
                      <select
                        value={row.vendor_id ?? ''}
                        onChange={e => handleAssignVendor(row, e.target.value)}
                        className={`text-xs border rounded px-1.5 py-1 max-w-[140px] focus:outline-none focus:ring-1 focus:ring-slate-900 ${
                          row.vendor_id ? 'border-gray-200 bg-white text-gray-700' : 'border-dashed border-gray-300 bg-gray-50 text-gray-400'
                        }`}
                      >
                        <option value="">미매칭</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50 max-w-md">
          {toast}
        </div>
      )}
    </div>
  )
}
