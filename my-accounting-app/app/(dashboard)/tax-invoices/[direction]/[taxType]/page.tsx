'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { TaxInvoice } from '@/types/tax-invoice'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'
import { lagDays } from '@/lib/matching-rules'

const DIRECTION_META: Record<string, { label: string; sub: string; color: string }> = {
  sales:    { label: '매출 세금계산서', sub: '받을 돈 (입금 확인)', color: 'text-blue-700' },
  purchase: { label: '매입 세금계산서', sub: '줄 돈 (출금 확인)',   color: 'text-orange-700' },
}
const TAX_TYPE_META: Record<string, string> = {
  taxable: '전자세금계산서 (과세)',
  exempt:  '전자계산서 (면세)',
}

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

// 거래 일시 표시 — 같은 날 여러 거래를 구분할 수 있게 시각까지
const txDT = (d?: string | null, t?: string | null) =>
  d ? (t ? `${d.slice(0, 10)} ${t.slice(0, 5)}` : d.slice(0, 10)) : '-'

// "매칭된 거래" 컬럼: 연결 1건이면 계좌·일자·금액, 분할/합산 연결이면 누적 진행률
function formatMatchedAccount(inv: TaxInvoice): string {
  const payments = inv.payments ?? []
  if (payments.length === 0) return ''
  if (payments.length === 1) {
    const p  = payments[0]
    const tx = p.transaction
    if (!tx) return won(p.amount)
    const acc = tx.bank_accounts
    const accountLabel = acc
      ? [acc.bank_name, acc.account_number].filter(Boolean).join(' ')
      : tx.account_alias ?? '계좌 미상'
    return `${accountLabel} · ${txDT(tx.tx_date, (tx as { tx_time?: string | null }).tx_time)} · ${won(p.amount)}`
  }
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0)
  return `${won(paidTotal)} / ${won(inv.total_amount)} (${payments.length}건)`
}

interface Candidate {
  id: string
  tx_date: string
  tx_time?: string | null
  description: string
  counterparty_name: string | null
  amount_in: number
  amount_out: number
  account_alias: string | null
  // 이미 계산서에 연결된 결제 내역 (거래 목록 API가 내려줌) — 잔여 금액 계산용
  invoice_links?: { amount: number }[]
}

// 거래에서 계산서 연결에 아직 쓸 수 있는 잔여 금액
const txRemaining = (tx: Candidate, amountKey: 'amount_in' | 'amount_out') =>
  (tx[amountKey] ?? 0) - (tx.invoice_links ?? []).reduce((s, l) => s + l.amount, 0)

// 발행 전 거래 배지 — 원칙(발행 후 지급/수금)의 예외임을 한눈에 보여준다
function PreIssueBadge({ txDate, issueDate }: { txDate: string; issueDate: string }) {
  const lag = lagDays(txDate, issueDate)
  if (lag >= 0) return null
  return (
    <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[11px] font-medium shrink-0">
      발행 전 {-lag}일
    </span>
  )
}

// ── 매칭 후보 선택 모달 ────────────────────────────────────────────
function MatchPickerModal({
  invoice, onClose, onMatched,
}: {
  invoice: TaxInvoice
  onClose: () => void
  onMatched: (inv: TaxInvoice) => void
}) {
  const [currentInvoice, setCurrentInvoice] = useState<TaxInvoice>(invoice)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [prepayVendor, setPrepayVendor] = useState(false)
  const [aliasPrompt, setAliasPrompt] = useState<{ matched: TaxInvoice; suggestion: string } | null>(null)
  const [aliasInput, setAliasInput]   = useState('')
  const [savingAlias, setSavingAlias] = useState(false)

  // 금액 연결 전 확인 단계 (분할/합산 결제를 위해, 후보 금액 그대로가 아니라 직접 지정한 금액만큼만 연결)
  const [confirmTarget, setConfirmTarget] = useState<{ txId: string; label: string; suggestion: string } | null>(null)
  const [confirmAmount, setConfirmAmount] = useState('')
  const [linking, setLinking]             = useState(false)
  const [linkError, setLinkError]         = useState<string | null>(null)
  const [removingId, setRemovingId]       = useState<string | null>(null)

  const payments   = currentInvoice.payments ?? []
  const paidTotal  = payments.reduce((s, p) => s + p.amount, 0)
  const remaining  = currentInvoice.total_amount - paidTotal

  // 금액이 정확히 일치하지 않는 경우(합계 입금, 수수료 차감 등)를 위한 수동 검색
  const issueOffset = (days: number) => {
    const d = new Date(invoice.issue_date)
    d.setDate(d.getDate() + days)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const [manualOpen, setManualOpen]       = useState(false)
  const [manualFrom, setManualFrom]       = useState(issueOffset(-30))
  const [manualTo, setManualTo]           = useState(issueOffset(30))
  const [manualQuery, setManualQuery]     = useState('')
  const [manualResults, setManualResults] = useState<Candidate[] | null>(null)
  const [manualLoading, setManualLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tax-invoices/${invoice.id}/match-candidates`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setCandidates(Array.isArray(d.candidates) ? d.candidates : [])
        setPrepayVendor(!!d.prepayVendor)
      })
      .catch(() => { if (!cancelled) setCandidates([]) })
    return () => { cancelled = true }
  }, [invoice.id])

  const handleManualSearch = async () => {
    setManualLoading(true)
    const params = new URLSearchParams({ status: 'all', limit: '500' })
    if (manualFrom) params.set('from', manualFrom)
    if (manualTo)   params.set('to', manualTo)
    const res  = await fetch(`/api/transactions?${params.toString()}`)
    const json = await res.json()
    setManualLoading(false)
    if (!Array.isArray(json.data)) { setManualResults([]); return }

    const amountKey = invoice.direction === 'sales' ? 'amount_in' : 'amount_out'
    const q = manualQuery.trim().toLowerCase()
    const results = (json.data as Candidate[])
      .filter(tx => (tx[amountKey] ?? 0) > 0)
      // 이미 다른 계산서 연결에 전액 사용된 거래는 제외 (잔여 금액이 있으면 표시)
      .filter(tx => txRemaining(tx, amountKey) > 0)
      .filter(tx => !q
        || (tx.description ?? '').toLowerCase().includes(q)
        || (tx.counterparty_name ?? '').toLowerCase().includes(q))
      .slice(0, 100)
    setManualResults(results)
  }

  const openConfirm = (c: Candidate) => {
    // 거래의 잔여 금액(이미 다른 계산서에 연결된 만큼 차감)을 기본값 상한으로
    const amountKey = invoice.direction === 'sales' ? 'amount_in' : 'amount_out'
    const candidateAmount = txRemaining(c, amountKey) || (c.amount_in || c.amount_out)
    const defaultAmount   = remaining > 0 ? Math.min(remaining, candidateAmount) : candidateAmount
    setLinkError(null)
    setConfirmAmount(String(defaultAmount))
    setConfirmTarget({ txId: c.id, label: `${c.description} · ${txDT(c.tx_date, c.tx_time)}`, suggestion: (c.counterparty_name ?? c.description).trim() })
  }

  const handleConfirmLink = async () => {
    if (!confirmTarget) return
    const amount = Number(confirmAmount)
    if (!Number.isFinite(amount) || amount <= 0) { setLinkError('연결할 금액을 올바르게 입력하세요.'); return }

    setLinking(true)
    const res = await fetch(`/api/tax-invoices/${invoice.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: confirmTarget.txId, amount }),
    })
    const json = await res.json()
    setLinking(false)
    if (!res.ok || !json.data) { setLinkError(json.error ?? '연결에 실패했습니다.'); return }

    const updated: TaxInvoice = json.data
    setCurrentInvoice(updated)
    onMatched(updated)

    const suggestion = confirmTarget.suggestion
    setConfirmTarget(null)
    setConfirmAmount('')

    if (updated.payment_status === 'matched') {
      if (updated.vendor_id && suggestion) {
        // 제안된 표현이 이미 별칭에 있거나 거래처명과 같으면 물어볼 필요가 없다
        // (없을 때만 프롬프트 — "이미 저장된 별칭도 계속 확인" 반복 제거)
        const norm = (s: string) => s.replace(/\s|주식회사|\(주\)|㈜/g, '').toLowerCase()
        const v = await fetch(`/api/vendors/${updated.vendor_id}`).then(r => r.json()).catch(() => null)
        const vname = v?.data?.name as string | undefined
        const aliases = (v?.data?.match_aliases as string[] | null) ?? []
        const known = (vname && norm(vname) === norm(suggestion))
          || aliases.some(a => norm(a) === norm(suggestion))
        if (!known) {
          setAliasInput(suggestion)
          setAliasPrompt({ matched: updated, suggestion })
          return
        }
      }
      onClose()
    }
  }

  const handleRemovePayment = async (paymentId: string) => {
    setRemovingId(paymentId)
    const res = await fetch(`/api/tax-invoices/${invoice.id}/payments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId }),
    })
    const json = await res.json()
    setRemovingId(null)
    if (res.ok && json.data) {
      setCurrentInvoice(json.data)
      onMatched(json.data)
    }
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

  if (confirmTarget) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-gray-900 mb-1">연결할 금액 확인</h2>
          <p className="text-sm text-gray-500 mb-4">{confirmTarget.label}</p>
          <label className="block text-xs text-gray-500 mb-1">이 계산서에 연결할 금액</label>
          <input
            type="number"
            autoFocus
            value={confirmAmount}
            onChange={e => setConfirmAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <p className="text-xs text-gray-400 mt-1.5">
            합계금액 {won(currentInvoice.total_amount)} · 남은 금액 {won(remaining)}
          </p>
          {linkError && <p className="text-xs text-red-500 mt-1.5">{linkError}</p>}
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => { setConfirmTarget(null); setLinkError(null) }}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={handleConfirmLink}
              disabled={linking}
              className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              {linking ? '연결 중...' : '연결'}
            </button>
          </div>
        </div>
      </div>
    )
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
          {invoice.counterparty_name ?? '거래처 미상'} · {won(currentInvoice.total_amount)} · {invoice.issue_date}
        </p>

        {payments.length > 0 && (
          <div className="mb-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2">
              연결된 결제 내역 · {won(paidTotal)} / {won(currentInvoice.total_amount)}
            </p>
            <div className="space-y-1">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs bg-white border border-gray-200 rounded px-2 py-1.5 gap-2">
                  <span className="truncate text-gray-700">
                    {txDT(p.transaction?.tx_date, (p.transaction as { tx_time?: string | null } | null)?.tx_time)} · {p.transaction?.description ?? '-'}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-medium text-gray-900">{won(p.amount)}</span>
                    <button
                      onClick={() => handleRemovePayment(p.id)}
                      disabled={removingId !== null}
                      className="text-gray-400 hover:text-red-600 underline disabled:opacity-50"
                    >
                      {removingId === p.id ? '해제 중...' : '해제'}
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {remaining > 0 && (
              <p className="text-xs text-amber-600 mt-2">남은 금액 {won(remaining)}을 추가로 연결해야 확인 완료됩니다.</p>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 mb-3">
          금액이 일치하는 거래내역 중 사업자번호·거래처명이 일치하는 항목을 우선 표시합니다.
          발행일 이후 거래가 위로 정렬되며, 발행 전 거래는 배지로 구분됩니다.
        </p>
        {prepayVendor && (
          <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-3">
            선지급 관행 거래처 — 이 거래처는 계산서 발행 전에 지급한 확정 이력이 많아, 발행 전 거래도 동급으로 표시합니다.
          </p>
        )}
        {candidates === null ? (
          <div className="py-10 text-center text-gray-400 text-sm">후보 검색 중...</div>
        ) : candidates.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">금액이 일치하는 거래내역을 찾지 못했습니다.</div>
        ) : (
          <div className="space-y-1.5">
            {candidates.map(c => (
              <button
                key={c.id}
                onClick={() => openConfirm(c)}
                className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 text-sm flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-gray-900 truncate flex items-center gap-1.5">
                    <span className="truncate">{c.description}</span>
                    <PreIssueBadge txDate={c.tx_date} issueDate={invoice.issue_date} />
                  </p>
                  <p className="text-xs text-gray-400">
                    {txDT(c.tx_date, c.tx_time)} · {c.account_alias ?? '-'}
                    {c.counterparty_name ? ` · 보낸분/받는분: ${c.counterparty_name}` : ''}
                  </p>
                </div>
                <span className="font-medium text-gray-900 shrink-0">{won(c.amount_in || c.amount_out)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-100">
          <button onClick={() => setManualOpen(v => !v)} className="text-xs text-slate-500 hover:text-slate-900 underline">
            {manualOpen ? '직접 찾기 닫기' : '🔍 금액이 일치하는 후보가 없나요? 직접 찾기 (합계 입금, 수수료 차감 등)'}
          </button>
          {manualOpen && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <input type="date" value={manualFrom} onChange={e => setManualFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <span className="text-gray-400 text-sm">~</span>
                <input type="date" value={manualTo} onChange={e => setManualTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <input
                  value={manualQuery}
                  onChange={e => setManualQuery(e.target.value)}
                  placeholder="적요·보낸분 검색"
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-[120px] focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <button
                  onClick={handleManualSearch}
                  disabled={manualLoading}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                >
                  {manualLoading ? '검색 중...' : '검색'}
                </button>
              </div>
              {manualResults !== null && (
                manualResults.length === 0 ? (
                  <div className="py-6 text-center text-gray-400 text-sm">조건에 맞는 거래내역이 없습니다.</div>
                ) : (
                  <div className="space-y-1.5">
                    {manualResults.map(c => {
                      const amountKey = invoice.direction === 'sales' ? 'amount_in' as const : 'amount_out' as const
                      const remain = txRemaining(c, amountKey)
                      const full = c.amount_in || c.amount_out
                      return (
                        <button
                          key={c.id}
                          onClick={() => openConfirm(c)}
                          className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 text-sm flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-gray-900 truncate flex items-center gap-1.5">
                              <span className="truncate">{c.description}</span>
                              <PreIssueBadge txDate={c.tx_date} issueDate={invoice.issue_date} />
                            </p>
                            <p className="text-xs text-gray-400">
                              {txDT(c.tx_date, c.tx_time)} · {c.account_alias ?? '-'}
                              {c.counterparty_name ? ` · 보낸분/받는분: ${c.counterparty_name}` : ''}
                            </p>
                          </div>
                          <span className="font-medium text-gray-900 shrink-0 text-right">
                            {won(full)}
                            {remain < full && (
                              <span className="block text-[11px] font-normal text-sky-600">잔여 {won(remain)}</span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  )
}

// ── 합계 매칭 후보 선택 모달 (여러 계산서 → 합계가 일치하는 거래 1건) ──
function SumMatchPickerModal({
  invoiceIds, onClose, onMatched,
}: {
  invoiceIds: string[]
  onClose: () => void
  onMatched: (invoices: TaxInvoice[]) => void
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [sumAmount, setSumAmount]   = useState<number | null>(null)
  const [latestIssueDate, setLatestIssueDate] = useState<string | null>(null)
  const [prepayVendor, setPrepayVendor]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [picking, setPicking]       = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tax-invoices/match-sum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceIds }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) { setError(d.error); setCandidates([]); return }
        setSumAmount(d.sumAmount ?? null)
        setLatestIssueDate(d.latestIssueDate ?? null)
        setPrepayVendor(!!d.prepayVendor)
        setCandidates(Array.isArray(d.candidates) ? d.candidates : [])
      })
      .catch(() => { if (!cancelled) { setError('후보 검색에 실패했습니다.'); setCandidates([]) } })
    return () => { cancelled = true }
  }, [invoiceIds])

  const handlePick = async (txId: string) => {
    setPicking(txId)
    const res = await fetch('/api/tax-invoices/match-sum', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceIds, transactionId: txId }),
    })
    const json = await res.json()
    setPicking(null)
    if (!res.ok || !json.data) { setError(json.error ?? '매칭에 실패했습니다.'); return }
    onMatched(json.data)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1">선택한 계산서 {invoiceIds.length}건 합계로 매칭</h2>
        <p className="text-sm text-gray-500 mb-4">
          {sumAmount != null ? `합계 ${won(sumAmount)}` : '합계 계산 중...'}
        </p>
        <p className="text-xs text-gray-400 mb-3">
          선택한 계산서들의 합계금액과 정확히 일치하는 거래내역을 보여줍니다. 고르면 선택한 계산서 전부가 해당 거래 1건에 연결됩니다.
          발행일(가장 늦은 계산서 기준) 이후 거래가 위로 정렬됩니다.
        </p>
        {prepayVendor && (
          <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-3">
            선지급 관행 거래처 — 계산서 발행 전에 지급한 확정 이력이 많아, 발행 전 거래도 동급으로 표시합니다.
          </p>
        )}
        {error ? (
          <div className="py-10 text-center text-red-500 text-sm">{error}</div>
        ) : candidates === null ? (
          <div className="py-10 text-center text-gray-400 text-sm">후보 검색 중...</div>
        ) : candidates.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">합계금액이 일치하는 거래내역을 찾지 못했습니다.</div>
        ) : (
          <div className="space-y-1.5">
            {candidates.map(c => (
              <button
                key={c.id}
                onClick={() => handlePick(c.id)}
                disabled={picking !== null}
                className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 text-sm flex items-center justify-between gap-3 disabled:opacity-50"
              >
                <div className="min-w-0">
                  <p className="text-gray-900 truncate flex items-center gap-1.5">
                    <span className="truncate">{c.description}</span>
                    {latestIssueDate && <PreIssueBadge txDate={c.tx_date} issueDate={latestIssueDate} />}
                  </p>
                  <p className="text-xs text-gray-400">
                    {txDT(c.tx_date, c.tx_time)} · {c.account_alias ?? '-'}
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
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">로딩 중...</div>}>
      <TaxInvoiceListContent />
    </Suspense>
  )
}

function TaxInvoiceListContent() {
  const params    = useParams<{ direction: string; taxType: string }>()
  const searchParams = useSearchParams()
  const direction = params.direction
  const taxType   = params.taxType
  const valid     = (direction === 'sales' || direction === 'purchase') && (taxType === 'taxable' || taxType === 'exempt')

  const [invoices, setInvoices]       = useState<TaxInvoice[]>([])
  const [accounts, setAccounts]       = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading]         = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [search, setSearch]           = useState('')
  // 원본 상세 등에서 특정 계산서로 바로 진입 (?invoiceId=) — 그 건만 표시
  const [focusId, setFocusId]         = useState<string | null>(() => searchParams.get('invoiceId'))
  const [uploading, setUploading]     = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [matching, setMatching]       = useState(false)
  const [matchingInvoice, setMatchingInvoice] = useState<TaxInvoice | null>(null)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [sumMatching, setSumMatching] = useState(false)
  const [bulkBusy, setBulkBusy]       = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [toast, setToast]             = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const load = useCallback(async () => {
    if (!valid) return
    setLoading(true)
    const params = new URLSearchParams({ direction, taxType })
    if (statusFilter !== 'all') params.set('paymentStatus', statusFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to', dateTo)
    const res  = await fetch(`/api/tax-invoices?${params.toString()}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setInvoices(json.data)
    setLoading(false)
  }, [valid, direction, taxType, statusFilter, dateFrom, dateTo])

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
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const a = document.createElement('a')
    a.href = `/api/tax-invoices/export?${p}`
    a.click()
    setExporting(false)
  }, [direction, taxType, statusFilter, dateFrom, dateTo])

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

    let msg = `${json.imported}건 처리 — 신규 ${json.created ?? 0}건 · 기존갱신(중복) ${json.updated ?? 0}건 (신규 거래처 ${json.vendorsCreated}곳)`
    if (json.skipped)    msg += ` · 건너뜀 ${json.skipped}건`
    if (json.mismatched) msg += ` · ⚠ 방향이 다른 것으로 보이는 건 ${json.mismatched}개 (메뉴를 다시 확인해주세요)`
    if (json.taxTypeCorrected) msg += ` · 파일이 ${json.taxTypeCorrected === 'exempt' ? '전자계산서(면세)' : '전자세금계산서(과세)'} 양식이라 해당 유형으로 저장했습니다 (해당 탭에서 확인)`
    showMsg(msg)
    load()
  }

  // ids를 주면 그 선택 건들만 자동매칭, 없으면 화면 전체(미확인) 대상
  const handleAutoMatch = async (ids?: string[]) => {
    setMatching(true)
    const res  = await fetch('/api/tax-invoices/auto-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, taxType, ...(ids?.length ? { invoiceIds: ids } : {}) }),
    })
    const json = await res.json()
    setMatching(false)
    if (!res.ok) { showMsg(`매칭 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(`${ids?.length ? `선택 ${ids.length}건 중 ` : `${json.checked}건 중 `}${json.matched}건 자동 매칭됨`)
    setSelected(new Set())
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
    const res  = await fetch(`/api/tax-invoices/${inv.id}/payments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const json = await res.json()
    if (res.ok && json.data) setInvoices(prev => prev.map(x => x.id === inv.id ? json.data : x))
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteSelected = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`선택한 ${ids.length}건을 삭제합니다.\n(잘못 업로드된 계산서 정리 등 — 되돌릴 수 없습니다)\n진행할까요?`)) return
    setDeleting(true)
    const res = await fetch('/api/tax-invoices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const json = await res.json()
    setDeleting(false)
    if (!res.ok) { showMsg(`삭제 실패: ${json.error ?? '오류'}`); return }
    showMsg(`${json.deleted ?? ids.length}건 삭제됨`)
    setSelected(new Set())
    load()
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

  // 매출 일괄분류: 미분류 매출 세금계산서를 매출(4001)로 일괄 지정 + 자동 분개
  const handleBulkClassifySales = async () => {
    const unclassified = invoices.filter(i => !i.confirmed_account_id).length
    if (unclassified === 0) { alert('미분류 매출 세금계산서가 없습니다.'); return }
    if (!confirm(`미분류 매출 세금계산서를 모두 '매출' 계정으로 분류하고 분개합니다.\n(과세·면세 포함, 현재 화면 외 전체 매출 대상)\n진행할까요?`)) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/tax-invoices/bulk-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'sales', accountId: '4f31d98f-e220-4911-9d7c-fba09ceb818e' }),
      })
      const json = await res.json()
      if (!res.ok) { alert(`일괄분류 실패: ${json.error ?? '오류'}`); return }
      alert(`매출 ${json.classified}건 분류·분개 완료 (오류 ${json.errors?.length ?? 0}건)`)
      load()
    } finally {
      setBulkBusy(false)
    }
  }

  // ── 검색 (거래처명·품목·비고) · 특정 계산서 진입(focusId)이 있으면 그 건만 ──
  const q = search.trim().toLowerCase()
  const filtered = focusId
    ? invoices.filter(i => i.id === focusId)
    : q
    ? invoices.filter(i =>
        (i.counterparty_name ?? '').toLowerCase().includes(q)
        || (i.item_name ?? '').toLowerCase().includes(q)
        || (i.note ?? '').toLowerCase().includes(q),
      )
    : invoices

  // 체크박스가 보이는(선택 가능한) 행 = 아직 매칭 안 된 건
  const selectableIds = filtered.filter(i => !i.matched_transaction_id).map(i => i.id)

  // ── 요약 통계 ────────────────────────────────────────────────────
  const totalAmt    = filtered.reduce((s, i) => s + (i.total_amount || 0), 0)
  const matchedList = filtered.filter(i => i.payment_status === 'matched')
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
            onClick={() => handleAutoMatch()}
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

      {/* 특정 계산서 진입 배지 (원본 상세 → 세금계산서 화면으로) */}
      {focusId && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-sky-50 border border-sky-200 rounded-lg text-sm text-sky-800">
          <span>
            연결된 계산서 1건만 표시하고 있습니다.
            {filtered.length === 0 && !loading && ' — 현재 필터(기간·확인 상태)에서는 보이지 않습니다. 전체 보기를 눌러주세요.'}
          </span>
          <button
            onClick={() => { setFocusId(null); setStatusFilter('all'); setDateFrom(''); setDateTo('') }}
            className="ml-auto px-2.5 py-1 border border-sky-300 rounded-md text-xs text-sky-700 hover:bg-sky-100 whitespace-nowrap"
          >
            전체 보기
          </button>
        </div>
      )}

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">발행 합계</p>
          <p className="text-lg font-bold text-gray-900">{won(totalAmt)}</p>
          <p className="text-xs text-gray-400">{filtered.length}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{direction === 'sales' ? '입금 확인' : '출금 확인'}</p>
          <p className="text-lg font-bold text-green-600">{won(matchedAmt)}</p>
          <p className="text-xs text-gray-400">{matchedList.length}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">{direction === 'sales' ? '미수 잔액' : '미지급 잔액'}</p>
          <p className={`text-lg font-bold ${remaining > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(remaining)}</p>
          <p className="text-xs text-gray-400">{filtered.length - matchedList.length}건</p>
        </div>
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

      {/* 필터: 기간 · 검색 · 확인 상태 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처명·품목·비고 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        {direction === 'sales' && (
          <button onClick={handleBulkClassifySales} disabled={bulkBusy}
            className="px-3 py-1.5 text-sm border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap"
            title="미분류 매출 세금계산서를 매출 계정으로 일괄 분류하고 분개합니다">
            {bulkBusy ? '처리 중…' : '매출 일괄분류'}
          </button>
        )}
        <div className="flex gap-1">
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
        {selected.size > 0 && (
          <button
            onClick={() => handleAutoMatch(Array.from(selected))}
            disabled={matching}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            ⚡ 선택 {selected.size}건 자동 매칭
          </button>
        )}
        {selected.size >= 2 && (
          <button
            onClick={() => setSumMatching(true)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700"
          >
            선택 {selected.size}건 합계로 매칭
          </button>
        )}
        {selectableIds.length > 0 && (
          <button onClick={() => setSelected(new Set(selectableIds))}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
            전체 선택 ({selectableIds.length})
          </button>
        )}
        {selected.size > 0 && (
          <button onClick={handleDeleteSelected} disabled={deleting}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">
            {deleting ? '삭제 중…' : `선택 ${selected.size}건 삭제`}
          </button>
        )}
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-600">
            선택 해제
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">등록된 세금계산서가 없습니다. 홈택스 파일을 업로드해주세요.</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">검색 결과가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium w-8">
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    checked={selectableIds.length > 0 && selectableIds.every(id => selected.has(id))}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && !selectableIds.every(id => selected.has(id)) }}
                    onChange={() => {
                      const all = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))
                      setSelected(all ? new Set() : new Set(selectableIds))
                    }}
                    title="전체 선택/해제"
                  />
                </th>
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
              {filtered.map(inv => (
                <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="py-2.5 px-3">
                    {!inv.matched_transaction_id && (
                      <input
                        type="checkbox"
                        checked={selected.has(inv.id)}
                        onChange={() => toggleSelect(inv.id)}
                        className="cursor-pointer"
                      />
                    )}
                  </td>
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
          onMatched={inv => {
            setInvoices(prev => prev.map(x => x.id === inv.id ? inv : x))
            setSelected(prev => { const next = new Set(prev); next.delete(inv.id); return next })
            showMsg('거래내역과 매칭되었습니다.')
          }}
        />
      )}

      {sumMatching && (
        <SumMatchPickerModal
          invoiceIds={Array.from(selected)}
          onClose={() => setSumMatching(false)}
          onMatched={updated => {
            const byId = new Map(updated.map(u => [u.id, u]))
            setInvoices(prev => prev.map(x => byId.get(x.id) ?? x))
            setSelected(new Set())
            showMsg(`${updated.length}건의 계산서가 하나의 거래내역에 매칭되었습니다.`)
          }}
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
