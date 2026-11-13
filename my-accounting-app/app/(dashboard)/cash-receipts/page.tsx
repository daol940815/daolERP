'use client'

import PeriodPresets from '@/components/ui/PeriodPresets'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { CashReceipt, CashReceiptDirection, CashReceiptTransactionType } from '@/types/cash-receipt'
import type { Vendor } from '@/types/tax-invoice'
import { getPeriodRange } from '@/lib/period-presets'
import SearchableSelect from '@/components/ui/SearchableSelect'
import ReceiptMatchModal from '@/components/cash-receipts/ReceiptMatchModal'
import type { CashReceiptPayment } from '@/types/cash-receipt'

// 425: 매출 발행 건의 입금 확인 상태
const PAY_META: Record<string, { label: string; cls: string }> = {
  unmatched: { label: '미확인', cls: 'bg-amber-100 text-amber-800' },
  partial:   { label: '부분',   cls: 'bg-sky-100 text-sky-700' },
  matched:   { label: '확인됨', cls: 'bg-emerald-100 text-emerald-700' },
}

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
  // 425: 입금 확인 상태 필터(매출 탭) · 매칭 모달 · 자동 매칭
  const [payFilter, setPayFilter] = useState<'all' | 'unmatched' | 'matched'>('all')
  // 통장 내역 '현금영수증' 열에서 진입(?receiptId=): 기간을 비우고 그 건만 보여 준다 (해제 칩으로 돌아감)
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('receiptId')
    if (id) { setFocusId(id); setDateFrom(''); setDateTo('') }
  }, [])
  const [matching, setMatching] = useState<CashReceipt | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)
  const [dateFrom,   setDateFrom]   = useState(() => getPeriodRange('당월').from)
  const [dateTo,     setDateTo]     = useState(() => getPeriodRange('당월').to)

  // 통합 검색 (2026-11-13 사용자 요청) — 승인번호 · 발행구분 · 용도 · 가맹점명 · 사업자번호 · 금액(숫자만 치면 총금액 일치). 불러온 행에서 즉시.
  const [search,    setSearch]    = useState('')
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [toast,     setToast]     = useState<string | null>(null)

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
  const toggleSelectAll = () => setSelected(prev => prev.size === visible.length ? new Set<string>() : new Set(visible.map(r => r.id)))

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

  // ── 검색 적용 (요약·전체 선택·표 모두 걸러진 행 기준) ──
  const q = search.trim().toLowerCase()
  const qNum = /^[\d,]+원?$/.test(search.trim()) ? Number(search.replace(/[^0-9]/g, '')) : null
  const payPass = (r: CashReceipt) => payFilter === 'all' || direction !== 'sales' ? true
    : payFilter === 'matched' ? r.payment_status === 'matched'
    : (r.transaction_type === 'approval' && r.payment_status !== 'matched')
  const visible = focusId ? receipts.filter(r => r.id === focusId) : (q || payFilter !== 'all')
    ? receipts.filter(r => payPass(r) && (!q || (() => {
        const has = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(q)
        return has(r.approval_number) || has(r.issue_type) || has(r.purpose_type) || has(r.counterparty_name) || has(r.note)
          || (r.counterparty_biz_number ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\u0000')
          || (qNum != null && Math.abs(r.amount || 0) === qNum)
          || (r.vendor_id ? has(vendors.find(v => v.id === r.vendor_id)?.name) : false)
      })()))
    : receipts
  // 입금 확인 KPI (매출 탭 · 승인 건 기준)
  const salesApprovals = receipts.filter(r => r.transaction_type === 'approval')
  const confirmedAmt = salesApprovals.reduce((s, r) => s + Math.min(Math.abs(r.amount || 0), (r.payments ?? []).reduce((a, p) => a + p.amount, 0)), 0)
  const unconfirmedAmt = salesApprovals.reduce((s, r) => s + Math.abs(r.amount || 0), 0) - confirmedAmt
  const unconfirmedCnt = salesApprovals.filter(r => r.payment_status !== 'matched').length
  const autoCnt = salesApprovals.filter(r => (r.payments ?? []).some(p => p.matched_by === 'auto')).length

  const onPaymentsChanged = (receiptId: string, payments: CashReceiptPayment[]) => {
    setReceipts(prev => prev.map(r => {
      if (r.id !== receiptId) return r
      const linked = payments.reduce((a, p) => a + p.amount, 0)
      const total = Math.abs(r.amount || 0)
      return { ...r, payments, payment_status: linked <= 0 ? 'unmatched' : linked >= total ? 'matched' : 'partial' }
    }))
  }
  const runAutoMatch = async () => {
    const ids = Array.from(selected).filter(id => receipts.find(r => r.id === id)?.transaction_type === 'approval')
    if (!ids.length) { showMsg('승인 건을 선택하세요.'); return }
    setAutoBusy(true)
    const res = await fetch('/api/cash-receipts/auto-match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    const json = await res.json().catch(() => ({}))
    setAutoBusy(false)
    if (!res.ok) { showMsg(`자동 매칭 실패: ${json.error ?? '오류'}`); return }
    showMsg(`자동 매칭 ${json.matched}건 · 후보 여러 개 ${json.ambiguous}건 · 후보 없음 ${json.none}건${json.skipped ? ` · 건너뜀 ${json.skipped}건` : ''}`)
    load()
  }

  // ── 요약 통계 (걸러진 행 기준) ──────────────────────────────────
  const cancelList   = visible.filter(r => r.transaction_type === 'cancel')
  const totalAmount  = visible.reduce((s, r) => s + (r.amount || 0), 0)
  const totalSupply  = visible.reduce((s, r) => s + (r.supply_amount || 0), 0)
  const totalTax     = visible.reduce((s, r) => s + (r.tax_amount || 0), 0)
  const deductible   = visible.filter(r => r.deductible === true)
  const deductibleTax = deductible.reduce((s, r) => s + (r.tax_amount || 0), 0)

  return (
    <div className="w-full">
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
          {/* 원본 업로드는 파일 업로드 단일 창구에서 (2026-10-12) */}
          <Link href="/upload?source=cash_receipts" className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
            ↑ 파일 업로드 →
          </Link>
        </div>
      </div>

      <div className="mt-3 mb-5 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500">
        홈택스 &gt; 조회/발급 &gt; 현금영수증 &gt; 사용내역(소비자)/매출내역(사업자) 조회 파일은 파일 업로드 화면에서 올립니다.
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
          <p className="text-xs text-gray-400">{visible.length}건{q && ` / 기간 내 ${receipts.length}건`} ({cancelList.length > 0 ? `취소 ${cancelList.length}건` : '취소 없음'})</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
          <p className="text-xs text-gray-400 mb-1">공급가액</p>
          <p className="text-lg font-bold text-gray-900">{won(totalSupply)}</p>
          <p className="text-xs text-gray-400">부가세 {won(totalTax)}</p>
        </div>
        {direction === 'sales' && (<>
          <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
            <p className="text-xs text-gray-400 mb-1">입금 확인됨</p>
            <p className="text-lg font-bold text-emerald-700">{won(confirmedAmt)}</p>
            <p className="text-xs text-gray-400">{salesApprovals.length - unconfirmedCnt}건 · 자동 {autoCnt}건</p>
          </div>
          <button onClick={() => setPayFilter(f => f === 'unmatched' ? 'all' : 'unmatched')}
            className={`border rounded-lg px-4 py-3 flex-1 min-w-[150px] text-left ${payFilter === 'unmatched' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'}`}
            title="클릭 = 미확인(부분 포함)만 보기">
            <p className="text-xs text-amber-700 mb-1">입금 미확인</p>
            <p className="text-lg font-bold text-amber-700">{won(unconfirmedAmt)}</p>
            <p className="text-xs text-gray-400">{unconfirmedCnt}건 — 입금이 없거나 아직 연결 안 됨</p>
          </button>
        </>)}
        {direction === 'purchase' && (
          <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
            <p className="text-xs text-gray-400 mb-1">공제 가능 세액</p>
            <p className="text-lg font-bold text-green-600">{won(deductibleTax)}</p>
            <p className="text-xs text-gray-400">공제 {deductible.length}건 · 불공제 {visible.length - deductible.length}건</p>
          </div>
        )}
      </div>

      {focusId && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">통장 내역에서 연결된 현금영수증 1건만 표시 중</span>
          <button onClick={() => { setFocusId(null); const r = getPeriodRange('당월'); setDateFrom(r.from); setDateTo(r.to); window.history.replaceState(null, '', '/cash-receipts') }} className="text-gray-500 hover:underline">✕ 전체 보기</button>
        </div>
      )}
      {/* 기간 빠른 선택 */}
      <PeriodPresets from={dateFrom} to={dateTo} onChange={(f, t) => { setFocusId(null); setDateFrom(f); setDateTo(t) }} className="mb-2" />

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
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="검색 — 승인번호 · 발행구분 · 용도 · 가맹점명 · 사업자번호 · 금액(숫자만)"
            className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
          <span className="absolute left-2.5 top-1.5 text-gray-400 text-sm">⌕</span>
        </div>
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
        {direction === 'sales' && (<>
          <div className="flex gap-1">
            {([['all', '입금 전체'], ['unmatched', `미확인 ${unconfirmedCnt}`], ['matched', `확인됨 ${salesApprovals.length - unconfirmedCnt}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setPayFilter(k)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${payFilter === k ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l}</button>
            ))}
          </div>
          {selected.size > 0 && (
            <button onClick={runAutoMatch} disabled={autoBusy}
              title="금액이 같고 발행일 ±7일 안에 미연결 입금이 딱 1건일 때만 연결합니다. 나머지는 행의 '매칭'에서 직접"
              className="px-3 py-1.5 border border-emerald-300 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-50 disabled:opacity-50">
              {autoBusy ? '매칭 중...' : `선택 ${selected.size}건 자동 매칭`}
            </button>
          )}
        </>)}

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
      ) : visible.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {q ? `불러온 ${receipts.length}건 안에 "${search.trim()}"에 맞는 현금영수증이 없습니다. 다른 기간이면 위 기간을 바꾸세요.` : '등록된 현금영수증이 없습니다. 홈택스에서 다운로드한 파일을 업로드해주세요.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium w-8">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === visible.length}
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
                {direction === 'sales' && (
                  <>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">입금 확인</th>
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">매칭된 입금</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
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
                    {direction === 'sales' && (
                      <>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {row.transaction_type === 'cancel'
                            ? <span className="text-xs text-gray-400">취소 건</span>
                            : (<>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${(PAY_META[row.payment_status ?? 'unmatched'] ?? PAY_META.unmatched).cls}`}>
                                {(PAY_META[row.payment_status ?? 'unmatched'] ?? PAY_META.unmatched).label}
                                {row.payment_status === 'partial' && ` ${(row.payments ?? []).reduce((a, p) => a + p.amount, 0).toLocaleString('ko-KR')}`}
                              </span>
                              {(row.payments ?? []).some(p => p.matched_by === 'auto') && <span className="ml-1 text-[0.6875rem] text-gray-400">자동</span>}
                              {row.payment_status !== 'matched' && (
                                <button onClick={() => setMatching(row)} className="ml-1.5 text-xs text-blue-600 hover:underline">매칭</button>
                              )}
                            </>)}
                        </td>
                        <td className="py-2.5 px-3 text-xs">
                          {(row.payments ?? []).length ? (row.payments ?? []).map(p => (
                            <span key={p.id} className="inline-flex items-center gap-1 mr-2">
                              <Link href={`/transactions?txId=${p.transaction?.id ?? ''}`} className="text-blue-700 hover:underline whitespace-nowrap" title="통장 내역의 그 행으로">
                                {p.transaction?.tx_date?.slice(5)} {p.transaction?.account_alias ?? ''} · {p.transaction?.counterparty_name || p.transaction?.description} {p.amount.toLocaleString('ko-KR')}
                              </Link>
                              <button onClick={async () => {
                                const res = await fetch(`/api/cash-receipts/${row.id}/payments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId: p.id }) })
                                const json = await res.json().catch(() => ({}))
                                if (!res.ok) { showMsg(json.error ?? '해제 실패'); return }
                                onPaymentsChanged(row.id, json.data ?? [])
                              }} className="text-gray-400 hover:text-red-600" title="연결 해제">✕</button>
                            </span>
                          )) : <span className="text-gray-300">—</span>}
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

      {matching && (
        <ReceiptMatchModal receipt={matching} onClose={() => setMatching(null)} onChanged={ps => onPaymentsChanged(matching.id, ps)} />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50 max-w-md">
          {toast}
        </div>
      )}
    </div>
  )
}
