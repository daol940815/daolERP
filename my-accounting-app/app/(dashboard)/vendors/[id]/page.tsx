'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { Vendor, TaxInvoice } from '@/types/tax-invoice'
import type { Transaction } from '@/types/transaction'
import type { CardSale } from '@/types/card-sale'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

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

function listHref(type: string) {
  return type === 'customer' ? '/erp-aliases?type=customer' : '/erp-aliases?type=purchase'
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

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [vendor,       setVendor]       = useState<Vendor | null>(null)
  const [invoices,     setInvoices]     = useState<TaxInvoice[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [cardSales,    setCardSales]    = useState<CardSale[]>([])
  const [loading,      setLoading]      = useState(true)
  const [notFound,     setNotFound]     = useState(false)

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
    return () => { cancelled = true }
  }, [id])

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

  if (loading) {
    return <div className="text-center py-20 text-gray-400">로딩 중...</div>
  }
  if (notFound || !vendor) {
    return <div className="text-center py-20 text-gray-400 text-sm">거래처를 찾을 수 없습니다.</div>
  }

  const tmeta = TYPE_META[vendor.type] ?? { label: vendor.type, cls: 'bg-gray-100 text-gray-600' }

  return (
    <div className="max-w-5xl mx-auto">
      <Link href={listHref(vendor.type)} className="text-xs text-gray-400 hover:text-gray-600">
        ← {vendor.type === 'customer' ? '매출처' : '매입처'} 관리
      </Link>

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
          href={listHref(vendor.type)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 shrink-0"
        >
          정보 수정 (관리 화면에서)
        </Link>
      </div>

      {/* 종합 현황 요약 */}
      <div className="flex gap-3 flex-wrap my-5">
        <SummaryCard
          label="누적 거래액"
          value={won(sales.total + purchase.total)}
          sub={`세금계산서 ${invoices.length}건`}
        />
        <SummaryCard
          label="미수금 잔액"
          value={won(sales.remaining)}
          color={sales.remaining > 0 ? 'text-red-600' : 'text-gray-400'}
          sub={sales.count ? `매출 ${sales.count}건 중 ${sales.matchedCount}건 수금` : '매출 내역 없음'}
        />
        <SummaryCard
          label="미지급 잔액"
          value={won(purchase.remaining)}
          color={purchase.remaining > 0 ? 'text-red-600' : 'text-gray-400'}
          sub={purchase.count ? `매입 ${purchase.count}건 중 ${purchase.matchedCount}건 지급` : '매입 내역 없음'}
        />
        <SummaryCard
          label="최근 거래일"
          value={lastTxDate ?? '—'}
          sub={`입출금 ${transactions.length}건 · 카드결제 ${cardSales.length}건`}
        />
        {vendor.ledger_balance != null && (
          <SummaryCard
            label="거래처원장 잔액"
            value={won(vendor.ledger_balance)}
            sub={vendor.ledger_balance_updated_at ? `${vendor.ledger_balance_updated_at} 기준 (거래처 통보값)` : '거래처 통보값'}
          />
        )}
      </div>

      {/* 세금계산서 내역 */}
      <Section title="세금계산서 내역">
        {invoices.length === 0 ? (
          <EmptyRow>연결된 세금계산서가 없습니다.</EmptyRow>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2 px-3 font-medium">발행일</th>
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
                  return (
                    <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 whitespace-nowrap text-gray-600">{inv.issue_date}</td>
                      <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${dmeta.cls}`}>{dmeta.label}</span></td>
                      <td className="py-2 px-3 min-w-0"><p className="truncate max-w-[220px] text-gray-700">{inv.item_name ?? '—'}</p></td>
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
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 30).map(tx => (
                  <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap text-gray-600">{tx.tx_date?.slice(0, 10)}</td>
                    <td className="py-2 px-3 min-w-0"><p className="truncate max-w-[260px] text-gray-700">{tx.description}</p></td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-blue-600 font-medium">{tx.amount_in ? won(tx.amount_in) : ''}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-red-600 font-medium">{tx.amount_out ? won(tx.amount_out) : ''}</td>
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
    </div>
  )
}
