'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CashReceipt, CashReceiptDirection, CashReceiptTransactionType } from '@/types/cash-receipt'
import type { Vendor } from '@/types/tax-invoice'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'
import SearchableSelect from '@/components/ui/SearchableSelect'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

const TYPE_META: Record<CashReceiptTransactionType, { label: string; cls: string }> = {
  approval: { label: '승인', cls: 'bg-blue-100 text-blue-700' },
  cancel:   { label: '취소', cls: 'bg-red-100 text-red-700'  },
}

export default function CashReceiptsPage() {
  const [direction, setDirection] = useState<CashReceiptDirection>('sales')
  const [receipts, setReceipts]   = useState<CashReceipt[]>([])
  const [vendors,  setVendors]    = useState<Vendor[]>([])
  const [loading,  setLoading]    = useState(true)

  const [typeFilter, setTypeFilter] = useState<'all' | CashReceiptTransactionType>('all')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')

  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [toast,     setToast]     = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ direction })
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to',   dateTo)

    const res  = await fetch(`/api/cash-receipts?${params}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setReceipts(json.data)
    setSelected(new Set())
    setLoading(false)
  }, [direction, typeFilter, dateFrom, dateTo])

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
    const res  = await fetch('/api/cash-receipts/import', { method: 'POST', body: fd })
    const json = await res.json()
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!res.ok) { showMsg(`업로드 실패: ${json.error ?? '알 수 없는 오류'}`); return }

    const dirLabel = json.format === 'purchase' ? '수취(매입)' : '발행(매출)'
    let msg = `${dirLabel} ${json.imported}건 처리 — 신규 ${json.created ?? 0}건 · 기존갱신(중복) ${json.updated ?? 0}건`
    if (json.skipped) msg += ` · 건너뜀 ${json.skipped}건`
    showMsg(msg)
    if (json.format) setDirection(json.format)
    load()
  }

  const handleAssignVendor = async (row: CashReceipt, vendorId: string) => {
    const res  = await fetch(`/api/cash-receipts/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: vendorId || null }),
    })
    const json = await res.json()
    if (res.ok && json.data) setReceipts(prev => prev.map(x => x.id === row.id ? json.data : x))
  }

  const handleExport = useCallback(() => {
    setExporting(true)
    const params = new URLSearchParams({ direction })
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to',   dateTo)
    const a = document.createElement('a')
    a.href = `/api/cash-receipts/export?${params}`
    a.click()
    setExporting(false)
  }, [direction, typeFilter, dateFrom, dateTo])

  const toggleSelect    = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id) } else { n.add(id) } return n })
  const toggleSelectAll = () => setSelected(prev => prev.size === receipts.length ? new Set<string>() : new Set(receipts.map(r => r.id)))

  const handleBulkDelete = async () => {
    if (!selected.size) return
    if (!window.confirm(`선택한 ${selected.size}건을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return
    setDeleting(true)
    const res  = await fetch('/api/cash-receipts', {
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

  // ── 요약 통계 ──────────────────────────────────────────────────
  const cancelList   = receipts.filter(r => r.transaction_type === 'cancel')
  const totalAmount  = receipts.reduce((s, r) => s + (r.amount || 0), 0)
  const totalSupply  = receipts.reduce((s, r) => s + (r.supply_amount || 0), 0)
  const totalTax     = receipts.reduce((s, r) => s + (r.tax_amount || 0), 0)
  const deductible   = receipts.filter(r => r.deductible === true)
  const deductibleTax = deductible.reduce((s, r) => s + (r.tax_amount || 0), 0)

  return (
    <div className="max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">현금영수증</h1>
          <p className="text-sm mt-1 text-gray-500">홈택스 현금영수증 발행(매출) · 수취(매입) 내역</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={handleExport}
            disabled={exporting || loading || receipts.length === 0}
            className="px-3 py-2 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            ↓ {exporting ? '다운로드 중...' : '엑셀 다운로드'}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            ↑ {uploading ? '업로드 중...' : '홈택스 파일 업로드'}
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
        홈택스 &gt; 조회/발급 &gt; 현금영수증 &gt; 사용내역(소비자)/매출내역(사업자) 조회에서 다운로드한 파일을 그대로 업로드하세요.
        파일 형식에 따라 발행(매출) / 수취(매입)가 자동으로 구분됩니다.
      </div>

      {/* 방향 탭 */}
      <div className="flex gap-1 mb-5">
        {([
          { key: 'sales',    label: '발행 (매출)',   color: 'text-blue-700'   },
          { key: 'purchase', label: '수취 (매입)',   color: 'text-orange-700' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setDirection(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              direction === tab.key
                ? 'bg-slate-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
          <p className="text-xs text-gray-400 mb-1">{direction === 'sales' ? '발행 합계' : '수취 합계'} (취소 반영)</p>
          <p className="text-lg font-bold text-gray-900">{won(totalAmount)}</p>
          <p className="text-xs text-gray-400">{receipts.length}건 ({cancelList.length > 0 ? `취소 ${cancelList.length}건` : '취소 없음'})</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
          <p className="text-xs text-gray-400 mb-1">공급가액</p>
          <p className="text-lg font-bold text-gray-900">{won(totalSupply)}</p>
          <p className="text-xs text-gray-400">부가세 {won(totalTax)}</p>
        </div>
        {direction === 'purchase' && (
          <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
            <p className="text-xs text-gray-400 mb-1">공제 가능 세액</p>
            <p className="text-lg font-bold text-green-600">{won(deductibleTax)}</p>
            <p className="text-xs text-gray-400">공제 {deductible.length}건 · 불공제 {receipts.length - deductible.length}건</p>
          </div>
        )}
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
          type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <span className="text-gray-400 text-sm">~</span>
        <input
          type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <div className="flex gap-1">
          {([
            { key: 'all',      label: '전체' },
            { key: 'approval', label: '승인' },
            { key: 'cancel',   label: '취소' },
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

      {/* 테이블 */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : receipts.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          등록된 현금영수증이 없습니다. 홈택스에서 다운로드한 파일을 업로드해주세요.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium w-8">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === receipts.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">거래일시</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">유형</th>
                {direction === 'sales' ? (
                  <>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">발행구분</th>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">용도</th>
                  </>
                ) : (
                  <>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">가맹점명</th>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">사업자번호</th>
                  </>
                )}
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">공급가액</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">부가세</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">
                  {direction === 'sales' ? '총금액' : '매입금액'}
                </th>
                {direction === 'purchase' && (
                  <>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">공제</th>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">거래처</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {receipts.map(row => {
                const meta = TYPE_META[row.transaction_type]
                return (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50 align-middle">
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
                    {direction === 'sales' ? (
                      <>
                        <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{row.issue_type ?? '-'}</td>
                        <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{row.purpose_type ?? '-'}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-2.5 px-3 text-gray-700 whitespace-nowrap">{row.counterparty_name ?? '-'}</td>
                        <td className="py-2.5 px-3 text-xs text-gray-400 whitespace-nowrap font-mono">{row.counterparty_biz_number ?? '-'}</td>
                      </>
                    )}
                    <td className="py-2.5 px-3 text-right text-gray-600 whitespace-nowrap">{won(row.supply_amount)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600 whitespace-nowrap">{won(row.tax_amount)}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span className={`font-medium ${row.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{won(row.amount)}</span>
                    </td>
                    {direction === 'purchase' && (
                      <>
                        <td className="py-2.5 px-3">
                          {row.deductible === true  && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">공제</span>}
                          {row.deductible === false && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">불공제</span>}
                          {row.deductible === null  && <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="py-2.5 px-3">
                          <SearchableSelect
                            value={row.vendor_id ?? ''}
                            onChange={id => handleAssignVendor(row, id)}
                            options={vendors.map(v => ({ id: v.id, label: v.name }))}
                            emptyLabel="미매칭"
                            className={`text-xs border rounded px-1.5 py-1 max-w-[140px] focus:outline-none focus:ring-1 focus:ring-slate-900 ${
                              row.vendor_id ? 'border-gray-200 bg-white text-gray-700' : 'border-dashed border-gray-300 bg-gray-50 text-gray-400'
                            }`}
                          />
                        </td>
                      </>
                    )}
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
