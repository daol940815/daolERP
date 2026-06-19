'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { Vendor, TaxInvoice } from '@/types/tax-invoice'
import type { Transaction } from '@/types/transaction'
import type { CardSale } from '@/types/card-sale'
import type { ErpVendorAlias } from '@/types/erp'
import type { VendorLedgerEntry, VendorLedgerSummary, VendorMonthlyLedgerRow, VendorLedgerEntryType } from '@/types/vendor-ledger'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`
const today = () => new Date().toISOString().slice(0, 10)

const TYPE_META: Record<string, { label: string; cls: string }> = {
  vendor:   { label: '매입처',    cls: 'bg-orange-100 text-orange-700' },
  customer: { label: '매출처',    cls: 'bg-blue-100 text-blue-700' },
  both:     { label: '매입+매출', cls: 'bg-purple-100 text-purple-700' },
}

const DIRECTION_META: Record<string, { label: string; cls: string }> = {
  sales:    { label: '매출', cls: 'bg-blue-100 text-blue-700' },
  purchase: { label: '매입', cls: 'bg-orange-100 text-orange-700' },
}

const PAYMENT_META: Record<string, { label: string; cls: string }> = {
  matched:   { label: '확인됨', cls: 'bg-green-100 text-green-700' },
  unmatched: { label: '미확인', cls: 'bg-gray-100 text-gray-500' },
}

const ENTRY_TYPE_META: Record<VendorLedgerEntryType, { label: string; cls: string }> = {
  opening:    { label: '기초잔액', cls: 'bg-slate-100 text-slate-600' },
  payment:    { label: '입금',     cls: 'bg-blue-100 text-blue-700' },
  adjustment: { label: '조정',     cls: 'bg-purple-100 text-purple-700' },
}

function listHref(type: string) {
  return type === 'customer' ? '/erp-aliases?type=customer' : '/vendors'
}

function summarizeInvoices(list: TaxInvoice[]) {
  const total      = list.reduce((s, i) => s + (i.total_amount || 0), 0)
  const matched    = list.filter(i => i.payment_status === 'matched')
  const matchedAmt = matched.reduce((s, i) => s + (i.total_amount || 0), 0)
  return { count: list.length, total, matchedCount: matched.length, matchedAmt, remaining: total - matchedAmt }
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-8 text-gray-400 text-xs border border-gray-200 rounded-xl">{children}</div>
}

// 입금/조정/기초잔액 추가 모달
function LedgerEntryModal({
  type, onClose, onSubmit,
}: {
  type: VendorLedgerEntryType
  onClose: () => void
  onSubmit: (entry: { entry_date: string; amount: number; memo: string }) => Promise<void>
}) {
  const [date, setDate]   = useState(today())
  const [amount, setAmount] = useState('')
  const [memo, setMemo]   = useState('')
  const [saving, setSaving] = useState(false)
  const meta = ENTRY_TYPE_META[type]

  const submit = async () => {
    const n = Number(amount.replace(/,/g, ''))
    if (!Number.isFinite(n) || n === 0) return
    setSaving(true)
    await onSubmit({ entry_date: date, amount: n, memo })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-80" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">{meta.label} 추가</h3>
        <div className="space-y-2.5">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">날짜</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">
              금액{type === 'adjustment' ? ' (감소는 음수로 입력)' : ''}
            </label>
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">메모</label>
            <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="사유를 입력하세요"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">취소</button>
          <button onClick={submit} disabled={saving} className="flex-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 disabled:opacity-50">
            {saving ? '저장 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [vendor,       setVendor]       = useState<Vendor | null>(null)
  const [invoices,     setInvoices]     = useState<TaxInvoice[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [cardSales,    setCardSales]    = useState<CardSale[]>([])
  const [aliases,      setAliases]      = useState<ErpVendorAlias[]>([])
  const [unmatchedAliases, setUnmatchedAliases] = useState<ErpVendorAlias[]>([])
  const [ledgerSummary, setLedgerSummary] = useState<VendorLedgerSummary | null>(null)
  const [monthlyRows,  setMonthlyRows]  = useState<VendorMonthlyLedgerRow[]>([])
  const [ledgerEntries, setLedgerEntries] = useState<VendorLedgerEntry[]>([])
  const [loading,      setLoading]      = useState(true)
  const [notFound,     setNotFound]     = useState(false)
  const [modalType,    setModalType]    = useState<VendorLedgerEntryType | null>(null)
  const [addingAlias,  setAddingAlias]  = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const loadLedger = useCallback(async () => {
    const [summaryRes, entriesRes] = await Promise.all([
      fetch(`/api/vendors/${id}/ledger-summary`).then(r => r.json()),
      fetch(`/api/vendor-ledger-entries?vendorId=${id}`).then(r => r.json()),
    ])
    if (summaryRes.summary) { setLedgerSummary(summaryRes.summary); setMonthlyRows(summaryRes.months ?? []) }
    if (Array.isArray(entriesRes.data)) setLedgerEntries(entriesRes.data)
  }, [id])

  const loadAliases = useCallback(async () => {
    const [linkedRes, unmatchedRes] = await Promise.all([
      fetch(`/api/erp-aliases?type=purchase&vendorId=${id}`).then(r => r.json()),
      fetch('/api/erp-aliases?type=purchase&unmatched=true').then(r => r.json()),
    ])
    if (Array.isArray(linkedRes.data)) setAliases(linkedRes.data)
    if (Array.isArray(unmatchedRes.data)) setUnmatchedAliases(unmatchedRes.data)
  }, [id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    Promise.all([
      fetch(`/api/vendors/${id}`).then(r => r.json()),
      fetch(`/api/tax-invoices?vendorId=${id}&limit=5000`).then(r => r.json()),
      fetch(`/api/transactions?vendorId=${id}&limit=2000`).then(r => r.json()),
      fetch(`/api/card-sales?vendorId=${id}&limit=2000`).then(r => r.json()),
    ]).then(([v, inv, tx, cs]) => {
      if (cancelled) return
      if (!v.data) { setNotFound(true); setLoading(false); return }
      setVendor(v.data)
      setInvoices(Array.isArray(inv.data) ? inv.data : [])
      setTransactions(Array.isArray(tx.data) ? tx.data : [])
      setCardSales(Array.isArray(cs.data) ? cs.data : [])
      setLoading(false)
    }).catch(() => { if (!cancelled) { setNotFound(true); setLoading(false) } })
    loadLedger()
    loadAliases()
    return () => { cancelled = true }
  }, [id, loadLedger, loadAliases])

  const sales    = useMemo(() => summarizeInvoices(invoices.filter(i => i.direction === 'sales')),    [invoices])
  const purchase = useMemo(() => summarizeInvoices(invoices.filter(i => i.direction === 'purchase')), [invoices])

  const lastTxDate = useMemo(() => {
    const dates = [
      ...invoices.map(i => i.issue_date),
      ...transactions.map(t => t.tx_date),
      ...cardSales.map(c => c.tx_date),
    ].filter(Boolean) as string[]
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  }, [invoices, transactions, cardSales])

  const registeredTxEntries = useMemo(
    () => new Map(
      ledgerEntries
        .filter(e => e.entry_type === 'payment' && e.transaction_id)
        .map(e => [e.transaction_id as string, e.id] as const),
    ),
    [ledgerEntries],
  )

  const addLedgerEntry = async (type: VendorLedgerEntryType, entry: { entry_date: string; amount: number; memo: string }) => {
    const res = await fetch('/api/vendor-ledger-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id: id, entry_type: type, ...entry }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`추가 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    setModalType(null)
    loadLedger()
  }

  const deleteLedgerEntry = async (entryId: string) => {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return
    const res = await fetch(`/api/vendor-ledger-entries/${entryId}`, { method: 'DELETE' })
    if (!res.ok) { showMsg('삭제 실패'); return }
    loadLedger()
  }

  const registerPayment = async (tx: Transaction) => {
    const res = await fetch('/api/vendor-ledger-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_id: id, entry_type: 'payment', entry_date: tx.tx_date.slice(0, 10),
        amount: tx.amount_out, memo: tx.description, transaction_id: tx.id,
      }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`등록 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg('입금 내역으로 등록했습니다.')
    loadLedger()
  }

  const unlinkAlias = async (aliasId: string) => {
    const res = await fetch('/api/erp-aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: aliasId, vendor_id: null }),
    })
    if (!res.ok) { showMsg('연결 해제 실패'); return }
    loadAliases()
  }

  const linkAlias = async (aliasId: string) => {
    setAddingAlias(false)
    const res = await fetch('/api/erp-aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: aliasId, vendor_id: id }),
    })
    if (!res.ok) { showMsg('연결 실패'); return }
    loadAliases()
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  }
  if (notFound || !vendor) {
    return <div className="text-center py-20 text-gray-400 text-sm">거래처를 찾을 수 없습니다.</div>
  }

  const tmeta = TYPE_META[vendor.type] ?? { label: vendor.type, cls: 'bg-gray-100 text-gray-600' }
  const showPurchaseLedger = vendor.type === 'vendor' || vendor.type === 'both'
  const showSalesCards     = vendor.type === 'customer' || vendor.type === 'both'

  return (
    <div className="max-w-5xl mx-auto">
      <Link href={listHref(vendor.type)} className="text-xs text-gray-400 hover:text-gray-600">
        ← {vendor.type === 'customer' ? '매출처' : '매입처'} 관리
      </Link>

      {msg && <div className="my-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기본 정보 */}
      <div className="flex items-start justify-between mt-1 mb-1">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{vendor.name}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${tmeta.cls}`}>{tmeta.label}</span>
            {!vendor.is_active && <span className="text-xs text-gray-400">(비활성)</span>}
          </div>
          <p className="text-sm text-gray-400 mt-1">
            {vendor.biz_number ?? '사업자번호 미등록'}
            {vendor.contact_name  && ` · 담당자 ${vendor.contact_name}`}
            {vendor.contact_phone && ` · ${vendor.contact_phone}`}
            {vendor.email         && ` · ${vendor.email}`}
          </p>
          {vendor.note && <p className="text-xs text-gray-500 mt-1.5">{vendor.note}</p>}
        </div>
        <Link
          href="/erp-aliases?type=purchase"
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 shrink-0"
        >
          정보 수정 (관리 화면에서)
        </Link>
      </div>

      {/* 연결 키워드 */}
      {showPurchaseLedger && (
        <div className="mt-3 mb-4">
          <p className="text-xs text-gray-400 mb-1.5">연결 키워드</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {aliases.length === 0 && <span className="text-xs text-gray-400">연결된 키워드가 없습니다.</span>}
            {aliases.map(a => (
              <span key={a.id} className="group inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-700">
                {a.erp_name}
                <button onClick={() => unlinkAlias(a.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 leading-none">✕</button>
              </span>
            ))}
            {addingAlias ? (
              <select
                autoFocus
                onChange={e => { if (e.target.value) linkAlias(e.target.value) }}
                onBlur={() => setAddingAlias(false)}
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                <option value="">선택...</option>
                {unmatchedAliases.map(a => <option key={a.id} value={a.id}>{a.erp_name}</option>)}
              </select>
            ) : (
              <button onClick={() => setAddingAlias(true)} className="text-xs px-2 py-1 border border-dashed border-gray-300 rounded text-gray-400 hover:border-slate-400 hover:text-slate-600">
                + 키워드 연결
              </button>
            )}
          </div>
        </div>
      )}

      {/* 종합 현황 요약 */}
      <div className="flex gap-3 flex-wrap my-5">
        <SummaryCard
          label="누적 거래액"
          value={won(sales.total + purchase.total)}
          sub={`세금계산서 ${invoices.length}건`}
        />
        {showSalesCards && (
          <SummaryCard
            label="미수금 잔액"
            value={won(sales.remaining)}
            color={sales.remaining > 0 ? 'text-red-600' : 'text-gray-400'}
            sub={sales.count ? `매출 ${sales.count}건 중 ${sales.matchedCount}건 수금` : '매출 내역 없음'}
          />
        )}
        <SummaryCard
          label="최근 거래일"
          value={lastTxDate ?? '—'}
          sub={`입출금 ${transactions.length}건 · 카드결제 ${cardSales.length}건`}
        />
        {vendor.ledger_balance != null && (
          <SummaryCard
            label="거래처원장 잔액 (거래처 통보값)"
            value={won(vendor.ledger_balance)}
            sub={vendor.ledger_balance_updated_at ? `${vendor.ledger_balance_updated_at} 기준` : undefined}
          />
        )}
      </div>

      {/* 정산 요약 */}
      {showPurchaseLedger && ledgerSummary && (
        <Section
          title="정산 요약"
          action={
            <div className="flex gap-1.5">
              <button onClick={() => setModalType('opening')} className="text-xs px-2.5 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">기초잔액 설정</button>
              <button onClick={() => setModalType('payment')} className="text-xs px-2.5 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">입금 추가</button>
              <button onClick={() => setModalType('adjustment')} className="text-xs px-2.5 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">조정 추가</button>
            </div>
          }
        >
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 text-gray-500">기초잔액</td>
                  <td className="py-2 px-3 text-right font-medium">{won(ledgerSummary.opening_balance)}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 text-gray-500">당월계산서</td>
                  <td className="py-2 px-3 text-right font-medium">{won(ledgerSummary.month_invoice)}</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 px-3 text-gray-500">당월입금</td>
                  <td className="py-2 px-3 text-right font-medium">{won(ledgerSummary.month_payment)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-gray-900 font-semibold">현재잔액</td>
                  <td className={`py-2 px-3 text-right font-bold ${ledgerSummary.current_balance > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {won(ledgerSummary.current_balance)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* 월별 정산현황 */}
      {showPurchaseLedger && (
        <Section title="월별 정산현황">
          {monthlyRows.length === 0 ? (
            <EmptyRow>정산 내역이 없습니다.</EmptyRow>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2 px-3 font-medium">월</th>
                    <th className="py-2 px-3 font-medium text-right">매입금액</th>
                    <th className="py-2 px-3 font-medium text-right">계산서</th>
                    <th className="py-2 px-3 font-medium text-right">입금</th>
                    <th className="py-2 px-3 font-medium text-right">조정</th>
                    <th className="py-2 px-3 font-medium text-right">잔액</th>
                  </tr>
                </thead>
                <tbody>
                  {[...monthlyRows].reverse().map(m => (
                    <tr key={m.month} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 whitespace-nowrap text-gray-700">{m.month}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{won(m.purchase_amount)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {won(m.invoice_amount)}
                        {m.invoice_carried_over && (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700">이월 발급</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">{won(m.payment_amount)}</td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap ${m.adjustment_amount < 0 ? 'text-red-600' : ''}`}>{won(m.adjustment_amount)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(m.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* 정산 원장 (입금/조정/기초잔액 추가 내역) */}
      {showPurchaseLedger && (
        <Section title="정산 원장">
          {ledgerEntries.length === 0 ? (
            <EmptyRow>추가된 입금/조정 내역이 없습니다.</EmptyRow>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2 px-3 font-medium">날짜</th>
                    <th className="py-2 px-3 font-medium">구분</th>
                    <th className="py-2 px-3 font-medium text-right">금액</th>
                    <th className="py-2 px-3 font-medium">메모</th>
                    <th className="py-2 px-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerEntries.map(e => {
                    const meta = ENTRY_TYPE_META[e.entry_type]
                    return (
                      <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50 group">
                        <td className="py-2 px-3 whitespace-nowrap text-gray-600">{e.entry_date}</td>
                        <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${meta.cls}`}>{meta.label}</span></td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${e.amount < 0 ? 'text-red-600' : ''}`}>{won(e.amount)}</td>
                        <td className="py-2 px-3 min-w-0"><p className="truncate max-w-[260px] text-gray-500">{e.memo ?? '—'}</p></td>
                        <td className="py-2 px-3 text-right">
                          <button onClick={() => deleteLedgerEntry(e.id)} className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500">삭제</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* 세금계산서 내역 */}
      <Section title="세금계산서 내역">
        {invoices.length === 0 ? (
          <EmptyRow>연결된 세금계산서가 없습니다.</EmptyRow>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2 px-3 font-medium">작성일</th>
                  <th className="py-2 px-3 font-medium">발급일</th>
                  <th className="py-2 px-3 font-medium">구분</th>
                  <th className="py-2 px-3 font-medium">품목</th>
                  <th className="py-2 px-3 font-medium text-right">금액</th>
                  <th className="py-2 px-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {invoices.slice(0, 30).map(inv => {
                  const dmeta = DIRECTION_META[inv.direction]
                  const pmeta = PAYMENT_META[inv.payment_status]
                  const carried = !!inv.issued_date && inv.issued_date.slice(0, 7) !== inv.issue_date.slice(0, 7)
                  return (
                    <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600">{inv.issue_date}</td>
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600">
                        {inv.issued_date ?? '—'}
                        {carried && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700">이월</span>}
                      </td>
                      <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${dmeta.cls}`}>{dmeta.label}</span></td>
                      <td className="py-2 px-3 min-w-0"><p className="truncate max-w-[200px] text-gray-700">{inv.item_name ?? '—'}</p></td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-gray-900 font-medium">{won(inv.total_amount)}</td>
                      <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${pmeta.cls}`}>{pmeta.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {invoices.length > 30 && (
              <p className="text-center text-xs text-gray-400 py-2 border-t border-gray-100">
                최근 30건만 표시 (전체 {invoices.length}건)
              </p>
            )}
          </div>
        )}
      </Section>

      {/* 입출금 내역 */}
      <Section
        title="입출금 내역"
        action={
          <Link href={`/transactions?vendorId=${vendor.id}`} className="text-xs text-slate-500 hover:text-slate-700">
            거래내역에서 전체 보기 →
          </Link>
        }
      >
        {transactions.length === 0 ? (
          <EmptyRow>연결된 입출금 내역이 없습니다. 거래내역 화면에서 &quot;거래처 자동 매칭&quot;을 실행해보세요.</EmptyRow>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2 px-3 font-medium">거래일자</th>
                  <th className="py-2 px-3 font-medium">내용/적요</th>
                  <th className="py-2 px-3 font-medium text-right">입금액</th>
                  <th className="py-2 px-3 font-medium text-right">출금액</th>
                  {showPurchaseLedger && <th className="py-2 px-3 font-medium"></th>}
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 30).map(tx => (
                  <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap text-gray-600">{tx.tx_date?.slice(0, 10)}</td>
                    <td className="py-2 px-3 min-w-0"><p className="truncate max-w-[260px] text-gray-700">{tx.description}</p></td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-blue-600 font-medium">{tx.amount_in ? won(tx.amount_in) : ''}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-red-600 font-medium">{tx.amount_out ? won(tx.amount_out) : ''}</td>
                    {showPurchaseLedger && (
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {tx.amount_out > 0 && (
                          registeredTxEntries.has(tx.id)
                            ? <button onClick={() => deleteLedgerEntry(registeredTxEntries.get(tx.id)!)} className="text-xs text-gray-400 hover:text-red-500 underline">등록됨 (취소)</button>
                            : <button onClick={() => registerPayment(tx)} className="text-xs text-slate-500 hover:text-slate-700 underline">입금으로 등록</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length > 30 && (
              <p className="text-center text-xs text-gray-400 py-2 border-t border-gray-100">
                최근 30건만 표시 (전체 {transactions.length}건)
              </p>
            )}
          </div>
        )}
      </Section>

      {/* 카드결제내역 */}
      {cardSales.length > 0 && (
        <Section title="카드결제내역">
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2 px-3 font-medium">결제일자</th>
                  <th className="py-2 px-3 font-medium">승인번호</th>
                  <th className="py-2 px-3 font-medium">카드번호</th>
                  <th className="py-2 px-3 font-medium text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                {cardSales.slice(0, 30).map(cs => (
                  <tr key={cs.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap text-gray-600">{cs.tx_date}</td>
                    <td className="py-2 px-3 text-gray-500 font-mono text-xs">{cs.approval_number}</td>
                    <td className="py-2 px-3 text-gray-500 font-mono text-xs">{cs.card_number ?? '—'}</td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${cs.transaction_type === 'cancel' ? 'text-red-600' : 'text-gray-900'}`}>
                      {cs.transaction_type === 'cancel' ? '-' : ''}{won(cs.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cardSales.length > 30 && (
              <p className="text-center text-xs text-gray-400 py-2 border-t border-gray-100">
                최근 30건만 표시 (전체 {cardSales.length}건)
              </p>
            )}
          </div>
        </Section>
      )}

      {modalType && (
        <LedgerEntryModal
          type={modalType}
          onClose={() => setModalType(null)}
          onSubmit={entry => addLedgerEntry(modalType, entry)}
        />
      )}
    </div>
  )
}
