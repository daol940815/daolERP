'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import type { TaxInvoice } from '@/types/tax-invoice'
import SearchableSelect from '@/components/ui/SearchableSelect'

const DIRECTION_META: Record<string, { label: string; sub: string; color: string }> = {
  sales:    { label: '매출 세금계산서', sub: '받을 돈 (입금 확인)', color: 'text-blue-700' },
  purchase: { label: '매입 세금계산서', sub: '줄 돈 (출금 확인)',   color: 'text-orange-700' },
}
const TAX_TYPE_META: Record<string, string> = {
  taxable: '전자세금계산서 (과세)',
  exempt:  '전자계산서 (면세)',
}

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

// "매칭된 거래" 컬럼: 은행명 + 계좌번호(없으면 별칭/은행명만)
function formatMatchedAccount(inv: TaxInvoice): string {
  const tx = inv.matched_transaction
  if (!tx) return '🔗 연결됨'
  const acc = tx.bank_accounts
  const accountLabel = acc
    ? [acc.bank_name, acc.account_number].filter(Boolean).join(' ')
    : tx.account_alias ?? '계좌 미상'
  return `${accountLabel} · ${tx.tx_date} · ${won(tx.amount_in || tx.amount_out)}`
}

interface Candidate {
  id: string
  tx_date: string
  description: string
  counterparty_name: string | null
  amount_in: number
  amount_out: number
  account_alias: string | null
}

// ── 매칭 후보 선택 모달 ────────────────────────────────────────────
function MatchPickerModal({
  invoice, onClose, onMatched,
}: {
  invoice: TaxInvoice
  onClose: () => void
  onMatched: (inv: TaxInvoice) => void
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [picking, setPicking]       = useState<string | null>(null)
  const [aliasPrompt, setAliasPrompt] = useState<{ matched: TaxInvoice; suggestion: string } | null>(null)
  const [aliasInput, setAliasInput]   = useState('')
  const [savingAlias, setSavingAlias] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tax-invoices/${invoice.id}/match-candidates`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setCandidates(Array.isArray(d.candidates) ? d.candidates : []) })
      .catch(() => { if (!cancelled) setCandidates([]) })
    return () => { cancelled = true }
  }, [invoice.id])

  const handlePick = async (txId: string, suggestion: string) => {
    setPicking(txId)
    const res = await fetch(`/api/tax-invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matched_transaction_id: txId }),
    })
    const json = await res.json()
    setPicking(null)
    if (!res.ok || !json.data) return

    const matched: TaxInvoice = json.data
    if (matched.vendor_id) {
      setAliasInput(suggestion.trim())
      setAliasPrompt({ matched, suggestion: suggestion.trim() })
      return
    }
    onMatched(matched)
    onClose()
  }

  const handleSaveAlias = async () => {
    if (!aliasPrompt) return
    const alias = aliasInput.trim()
    if (!alias) { onMatched(aliasPrompt.matched); onClose(); return }

    setSavingAlias(true)
    const vendorId = aliasPrompt.matched.vendor_id as string
    const vendorRes = await fetch(`/api/vendors/${vendorId}`).then(r => r.json()).catch(() => null)
    const existing: string[] = vendorRes?.data?.match_aliases ?? []
    const merged = existing.includes(alias) ? existing : [...existing, alias]

    await fetch(`/api/vendors/${vendorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_aliases: merged }),
    })
    setSavingAlias(false)
    onMatched(aliasPrompt.matched)
    onClose()
  }

  const handleSkipAlias = () => {
    if (!aliasPrompt) return
    onMatched(aliasPrompt.matched)
    onClose()
  }

  if (aliasPrompt) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-gray-900 mb-1">매칭 별칭으로 저장할까요?</h2>
          <p className="text-sm text-gray-500 mb-4">
            거래내역의 표현을 거래처 별칭으로 저장하면, 다음부터 이 거래처의 세금계산서를 자동으로 더 정확하게 매칭할 수 있습니다.
          </p>
          <input
            autoFocus
            value={aliasInput}
            onChange={e => setAliasInput(e.target.value)}
            placeholder="예: 입금자명 또는 적요 표현"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <div className="flex gap-2 mt-5">
            <button onClick={handleSkipAlias} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">건너뛰기</button>
            <button
              onClick={handleSaveAlias}
              disabled={savingAlias || !aliasInput.trim()}
              className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              {savingAlias ? '저장 중...' : '별칭으로 저장'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">거래내역 매칭</h2>
        <p className="text-sm text-gray-500 mb-4">
          {invoice.counterparty_name ?? '거래처 미상'} · {won(invoice.total_amount)} · {invoice.issue_date}
        </p>
        <p className="text-xs text-gray-400 mb-3">
          금액이 일치하는 거래내역 중 사업자번호·거래처명이 일치하는 항목을 우선 표시합니다.
        </p>
        {candidates === null ? (
          <div className="py-10 text-center text-gray-400 text-sm">후보 검색 중...</div>
        ) : candidates.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">금액이 일치하는 거래내역을 찾지 못했습니다.</div>
        ) : (
          <div className="space-y-1.5">
            {candidates.map(c => (
              <button
                key={c.id}
                onClick={() => handlePick(c.id, c.counterparty_name ?? c.description)}
                disabled={picking !== null}
                className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 text-sm flex items-center justify-between gap-3 disabled:opacity-50"
              >
                <div className="min-w-0">
                  <p className="text-gray-900 truncate">{c.description}</p>
                  <p className="text-xs text-gray-400">
                    {c.tx_date} · {c.account_alias ?? '-'}
                    {c.counterparty_name ? ` · 보낸분/받는분: ${c.counterparty_name}` : ''}
                  </p>
                </div>
                <span className="font-medium text-gray-900 shrink-0">
                  {picking === c.id ? '연결 중...' : won(c.amount_in || c.amount_out)}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  )
}

export default function TaxInvoiceListPage() {
  const params    = useParams<{ direction: string; taxType: string }>()
  const direction = params.direction
  const taxType   = params.taxType
  const valid     = (direction === 'sales' || direction === 'purchase') && (taxType === 'taxable' || taxType === 'exempt')

  const [invoices, setInvoices]       = useState<TaxInvoice[]>([])
  const [accounts, setAccounts]       = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading]         = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [uploading, setUploading]     = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [matching, setMatching]       = useState(false)
  const [matchingInvoice, setMatchingInvoice] = useState<TaxInvoice | null>(null)
  const [toast, setToast]             = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const load = useCallback(async () => {
    if (!valid) return
    setLoading(true)
    const params = new URLSearchParams({ direction, taxType })
    if (statusFilter !== 'all') params.set('paymentStatus', statusFilter)
    const res  = await fetch(`/api/tax-invoices?${params.toString()}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setInvoices(json.data)
    setLoading(false)
  }, [valid, direction, taxType, statusFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (direction !== 'purchase' && direction !== 'sales') return
    const type = direction === 'purchase' ? 'expense' : 'income'
    fetch(`/api/accounts?type=${type}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setAccounts(d.data) })
      .catch(() => {/* ignore */})
  }, [direction])

  const handleExport = useCallback(() => {
    setExporting(true)
    const p = new URLSearchParams({ direction, taxType })
    if (statusFilter !== 'all') p.set('paymentStatus', statusFilter)
    const a = document.createElement('a')
    a.href = `/api/tax-invoices/export?${p}`
    a.click()
    setExporting(false)
  }, [direction, taxType, statusFilter])

  if (!valid) {
    return <div className="text-center py-20 text-gray-400 text-sm">잘못된 경로입니다.</div>
  }

  const meta    = DIRECTION_META[direction]
  const taxLbl  = TAX_TYPE_META[taxType]

  const handleUpload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('direction', direction)
    fd.append('taxType', taxType)
    const res  = await fetch('/api/tax-invoices/import', { method: 'POST', body: fd })
    const json = await res.json()
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!res.ok) { showMsg(`업로드 실패: ${json.error ?? '알 수 없는 오류'}`); return }

    let msg = `${json.imported}건 저장 (신규 거래처 ${json.vendorsCreated}곳 등록)`
    if (json.skipped)    msg += ` · 건너뜀 ${json.skipped}건`
    if (json.mismatched) msg += ` · ⚠ 방향이 다른 것으로 보이는 건 ${json.mismatched}개 (메뉴를 다시 확인해주세요)`
    showMsg(msg)
    load()
  }

  const handleAutoMatch = async () => {
    setMatching(true)
    const res  = await fetch('/api/tax-invoices/auto-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, taxType }),
    })
    const json = await res.json()
    setMatching(false)
    if (!res.ok) { showMsg(`매칭 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(`${json.checked}건 중 ${json.matched}건 자동 매칭됨`)
    load()
  }

  const handleToggleStatus = async (inv: TaxInvoice) => {
    const next = inv.payment_status === 'matched' ? 'unmatched' : 'matched'
    const res  = await fetch(`/api/tax-invoices/${inv.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: next }),
    })
    const json = await res.json()
    if (res.ok && json.data) setInvoices(prev => prev.map(x => x.id === inv.id ? json.data : x))
  }

  const handleUnlink = async (inv: TaxInvoice) => {
    const res  = await fetch(`/api/tax-invoices/${inv.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matched_transaction_id: null }),
    })
    const json = await res.json()
    if (res.ok && json.data) setInvoices(prev => prev.map(x => x.id === inv.id ? json.data : x))
  }

  const handleAssignAccount = async (row: TaxInvoice, accountId: string) => {
    const res = await fetch(`/api/tax-invoices/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed_account_id: accountId || null }),
    })
    const json = await res.json()
    if (res.ok && json.data) {
      setInvoices(prev => prev.map(x => x.id === row.id ? json.data : x))
    }
  }

  // ── 요약 통계 ────────────────────────────────────────────────────
  const totalAmt    = invoices.reduce((s, i) => s + (i.total_amount || 0), 0)
  const matchedList = invoices.filter(i => i.payment_status === 'matched')
  const matchedAmt  = matchedList.reduce((s, i) => s + (i.total_amount || 0), 0)
  const remaining   = totalAmt - matchedAmt

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{meta.label} <span className="text-base font-normal text-gray-400">· {taxLbl}</span></h1>
          <p className={`text-sm mt-1 ${meta.color} font-medium`}>{meta.sub}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={handleExport}
            disabled={exporting || loading || invoices.length === 0}
            className="px-3 py-2 border border-emerald-300 rounded-lg text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            ↓ {exporting ? '다운로드 중...' : '엑셀 다운로드'}
          </button>
          <button
            onClick={handleAutoMatch}
            disabled={matching || invoices.length === 0}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            ⚡ {matching ? '매칭 중...' : '자동 매칭'}
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
        홈택스 &gt; 조회/발급 &gt; {taxLbl.includes('과세') ? '전자세금계산서' : '전자계산서'} &gt; 목록조회에서 다운로드한 파일을 그대로 업로드하세요.
        승인번호 기준으로 중복 없이 저장되며, 사업자번호·상호로 거래처가 자동 등록/매칭됩니다.
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">발행 합계</p>
          <p className="text-lg font-bold text-gray-900">{won(totalAmt)}</p>
          <p className="text-xs text-gray-400">{invoices.length}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{direction === 'sales' ? '입금 확인' : '출금 확인'}</p>
          <p className="text-lg font-bold text-green-600">{won(matchedAmt)}</p>
          <p className="text-xs text-gray-400">{matchedList.length}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{direction === 'sales' ? '미수 잔액' : '미지급 잔액'}</p>
          <p className={`text-lg font-bold ${remaining > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(remaining)}</p>
          <p className="text-xs text-gray-400">{invoices.length - matchedList.length}건</p>
        </div>
      </div>

      {/* 상태 필터 */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'all', label: '전체' },
          { key: 'matched', label: '확인됨' },
          { key: 'unmatched', label: '미확인' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key as typeof statusFilter)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === tab.key ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">등록된 세금계산서가 없습니다. 홈택스 파일을 업로드해주세요.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">작성일자</th>
                <th className="py-2.5 px-3 font-medium">거래처</th>
                <th className="py-2.5 px-3 font-medium">품목</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">공급가액</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">세액</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">합계금액</th>
                <th className="py-2.5 px-3 font-medium">계정과목</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">{direction === 'sales' ? '입금 확인' : '출금 확인'}</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">매칭된 거래</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="py-2.5 px-3 whitespace-nowrap text-gray-600">{inv.issue_date}</td>
                  <td className="py-2.5 px-3 min-w-0">
                    <p className="text-gray-900 truncate max-w-[180px]">{inv.counterparty_name ?? '-'}</p>
                    <p className="text-xs text-gray-400">{inv.counterparty_biz_number ?? ''}</p>
                  </td>
                  <td className="py-2.5 px-3 text-gray-500 max-w-[200px] truncate">{inv.item_name ?? '-'}</td>
                  <td className="py-2.5 px-3 text-right text-gray-600 whitespace-nowrap">{won(inv.supply_amount)}</td>
                  <td className="py-2.5 px-3 text-right text-gray-600 whitespace-nowrap">{won(inv.tax_amount)}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-gray-900 whitespace-nowrap">{won(inv.total_amount)}</td>
                  <td className="px-3 py-2">
                    <SearchableSelect
                      value={inv.confirmed_account_id ?? ''}
                      onChange={id => handleAssignAccount(inv, id)}
                      options={accounts.map(a => ({ id: a.id, label: a.name }))}
                      emptyLabel="(미분류)"
                      className={`min-w-[100px] text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-slate-900 ${
                        inv.confirmed_account_id
                          ? 'border-gray-200 bg-white text-gray-700'
                          : 'border-dashed border-gray-300 bg-gray-50 text-gray-400'
                      }`}
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <button
                      onClick={() => handleToggleStatus(inv)}
                      className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                        inv.payment_status === 'matched'
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                      title="클릭하여 수동으로 확인/미확인 전환"
                    >
                      {inv.payment_status === 'matched' ? '✓ 확인됨' : '미확인'}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {inv.matched_transaction_id ? (
                      <div>
                        <p className="text-xs text-slate-700">{formatMatchedAccount(inv)}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <button onClick={() => setMatchingInvoice(inv)} className="text-xs text-slate-500 hover:text-slate-900 underline">변경</button>
                          <button onClick={() => handleUnlink(inv)} className="text-xs text-gray-400 hover:text-red-600 underline">해제</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setMatchingInvoice(inv)} className="text-xs text-slate-600 hover:text-slate-900 underline">매칭하기</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {matchingInvoice && (
        <MatchPickerModal
          invoice={matchingInvoice}
          onClose={() => setMatchingInvoice(null)}
          onMatched={inv => { setInvoices(prev => prev.map(x => x.id === inv.id ? inv : x)); showMsg('거래내역과 매칭되었습니다.') }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50 max-w-md">
          {toast}
        </div>
      )}
    </div>
  )
}
