'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import InvoiceLinkModal from '../sales-cycle/invoice-link-modal'
import { BillingAskDialog, saveInvoiceLinks, type BillingAsk, type InvoiceLink } from '../sales-cycle/billing-ask'

// 결제 확인 › 계산서 확인 (2026-11-16 3단계)
// "발행할 주문 목록"은 만들 수 없다(카드로 낼지 계산서로 낼지 미리 알 수 없음) — 확인이 필요한 세 가지만 모은다.
//   홈택스에 없음: 계산서 발행 기록이 있는데 홈택스 계산서가 주문에 연결되지 않음
//   금액 다름: 기록 금액과 연결된 홈택스 계산서 금액이 다름
//   증빙 없음: 이체로 받았는데 계산서 · 현금영수증이 없음 (발행 누락 후보)

type Issue = 'no_hometax' | 'amount_diff' | 'no_evidence'
interface Row {
  issue: Issue; order_id: string; order_no: string | null; order_date: string
  customer_name: string; vendor_id: string | null; billing_name: string | null; net: number
  record_date: string | null; record_amount: number | null; invoice_amount: number
  paid_date: string | null; paid_amount: number | null
  need: number; vendor_has_billing: boolean; candidates: Cand[]; candidate_count: number
}
// 후보 계산서 — 남은 금액이 같고 발행일이 가까운 매출 계산서. foreign = 다른 거래처 명의
interface Cand { id: string; issue_date: string; remaining: number; counterparty_name: string | null; vendor_id: string | null; vendor_name: string; foreign: boolean }
const ISSUE: Record<Issue, { label: string; cls: string }> = {
  no_hometax: { label: '홈택스에 없음', cls: 'bg-amber-100 text-amber-800' },
  amount_diff: { label: '금액 다름', cls: 'bg-red-100 text-red-700' },
  no_evidence: { label: '증빙 없음', cls: 'bg-orange-100 text-orange-700' },
}
const won = (n: number) => n.toLocaleString('ko-KR')

export default function InvoiceTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [latest, setLatest] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [issue, setIssue] = useState<Issue | 'all'>('all')
  const [search, setSearch] = useState('')
  const [linkFor, setLinkFor] = useState<{ id: string; name: string } | null>(null)
  const [canSetBilling, setCanSetBilling] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<{ ask: BillingAsk; links: InvoiceLink[]; amount: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/payment-records/invoice-check')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error ?? '조회 실패'); setRows([]) }
    else { setRows(json.rows ?? []); setLatest(json.latest_invoice ?? null); setCanEdit(!!json.can_edit); setCanSetBilling(!!json.can_set_billing) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const count = (k: Issue) => rows.filter(r => r.issue === k).length

  // 후보 계산서 바로 연결 — 같은 매출처 것이면 확인 1회, 다른 거래처 명의면 청구처 지정을 묻는다
  const save = async (links: InvoiceLink[], billing?: { vendorId: string; billingVendorId: string }) => {
    setBusy(true); setMsg(null)
    const r = await saveInvoiceLinks(links, billing)
    setBusy(false); setAsk(null); setMsg(r.message)
    if (r.ok) load()
  }
  const linkCandidate = (r: Row, c: Cand) => {
    const links: InvoiceLink[] = [{ orderId: r.order_id, taxInvoiceId: c.id, amount: r.need, issueDate: c.issue_date }]
    if (!c.foreign) {
      if (confirm(`주문 ${r.order_no ?? ''}에 계산서 ${c.issue_date.slice(0, 10)} ${won(r.need)}원을 연결할까요?`)) save(links)
      return
    }
    setAsk({
      links, amount: r.need,
      ask: {
        orderVendorId: r.vendor_id ?? '', orderVendorName: r.customer_name, invoiceVendorId: c.vendor_id, invoiceVendorName: c.vendor_name,
        canSetBilling: !!r.vendor_id && !!c.vendor_id && !r.vendor_has_billing && canSetBilling,
        whyNot: !c.vendor_id ? '거래처가 연결되지 않은 계산서라 청구처 지정은 묻지 않습니다. 이번 연결만 저장합니다.'
          : r.vendor_has_billing ? `이 매출처는 이미 청구처(${r.billing_name ?? ''})가 지정되어 있습니다. 이번 연결만 저장합니다.`
            : '청구처 지정은 거래처 관리 수정 권한이 필요합니다. 이번 연결만 저장합니다.',
      },
    })
  }
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => (issue === 'all' || r.issue === issue)
      && (!q || [r.customer_name, r.billing_name, r.order_no].some(v => (v ?? '').toLowerCase().includes(q))))
  }, [rows, issue, search])

  const chip = (k: Issue | 'all', label: string, n: number) => (
    <button onClick={() => setIssue(issue === k ? 'all' : k)}
      className={`px-3 py-1 rounded-full text-xs border ${issue === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{label} {n}</button>
  )

  return (
    <div className="w-full">
      <p className="text-sm text-gray-500 mb-3">
        계산서를 발행했다고 기록했는데 홈택스 계산서가 없는 주문, 금액이 다른 주문, 이체로 받았는데 증빙이 없는 주문입니다.
        <span className="text-gray-400"> 매출 계산서 최신일 {latest ?? '없음'}</span>
      </p>
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {chip('all', '전체', rows.length)}
        {chip('no_hometax', '홈택스에 없음', count('no_hometax'))}
        {chip('amount_diff', '금액 다름', count('amount_diff'))}
        {chip('no_evidence', '입금 받았는데 증빙 없음', count('no_evidence'))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매출처 · 청구처 · 주문번호 검색"
          className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 max-w-full focus:outline-none focus:ring-2 focus:ring-slate-900" />
      </div>

      {loading ? <div className="text-center py-20 text-gray-400">불러오는 중...</div>
        : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">{rows.length === 0 ? '확인할 주문이 없습니다.' : '조건에 맞는 주문이 없습니다.'}</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[56rem]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2.5 px-3 font-medium">확인할 것</th>
                  <th className="py-2.5 px-3 font-medium">주문</th>
                  <th className="py-2.5 px-3 font-medium">매출처 · 청구처</th>
                  <th className="py-2.5 px-3 font-medium text-right">주문 금액</th>
                  <th className="py-2.5 px-3 font-medium">기록 · 원본</th>
                  <th className="py-2.5 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={`${r.issue}:${r.order_id}`} className="border-b border-gray-100 align-top hover:bg-gray-50">
                    <td className="py-2.5 px-3"><span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold ${ISSUE[r.issue].cls}`}>{ISSUE[r.issue].label}</span></td>
                    <td className="py-2.5 px-3 whitespace-nowrap tabular-nums">
                      {r.order_date}
                      <div><Link href={`/orders/${r.order_id}`} className="text-[0.6875rem] text-gray-500 hover:underline">{r.order_no ?? '-'}</Link></div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-gray-900">{r.customer_name || '-'}</div>
                      {r.billing_name && <div className="text-[0.6875rem] text-gray-500">청구처 {r.billing_name}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{won(r.net)}</td>
                    <td className="py-2.5 px-3 text-xs">
                      {r.issue === 'no_evidence' ? (<>
                        <div className="text-gray-700">이체 {r.paid_date?.slice(5)} 통장 입금 {won(r.paid_amount ?? 0)}원 매칭됨</div>
                        <div className="text-gray-400">계산서 · 현금영수증 연결 없음</div>
                      </>) : (<>
                        <div className="text-gray-700">계산서 {r.record_date?.slice(5)} 발행 기록 {won(r.record_amount ?? 0)}원</div>
                        {r.issue === 'no_hometax'
                          ? <div className="text-gray-400">홈택스 계산서 미연결</div>
                          : <div className="text-red-600">홈택스 계산서 {won(r.invoice_amount)}원 — {won(Math.abs(r.invoice_amount - (r.record_amount ?? 0)))}원 다름</div>}
                      </>)}
                      {/* 후보: 금액이 같고 날짜가 가까운 계산서 (다른 거래처 명의 포함). 하나뿐일 때만 바로 연결 */}
                      {r.candidate_count === 1 && (
                        <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5">
                          <span className="inline-block px-1.5 py-px rounded bg-green-100 text-green-800 text-[0.625rem] font-semibold mr-1">후보</span>
                          <b className="text-gray-800">{r.candidates[0].vendor_name}</b> 명의 계산서 {r.candidates[0].issue_date.slice(5, 10)} · {won(r.candidates[0].remaining)}원
                          <div className="text-[0.6875rem] text-gray-500">금액 같음 · {r.candidates[0].foreign ? '다른 거래처 명의' : '이 매출처 계산서'} · 다른 주문에 연결 안 됨</div>
                        </div>
                      )}
                      {r.candidate_count > 1 && (
                        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-600">
                          <span className="inline-block px-1.5 py-px rounded bg-gray-200 text-gray-700 text-[0.625rem] font-semibold mr-1">후보 {r.candidate_count}건</span>
                          금액이 같은 계산서가 여러 장 있습니다 — 직접 찾기로 골라 주세요
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {canEdit && r.candidate_count === 1 && (
                        <div className="mb-1">
                          <button onClick={() => linkCandidate(r, r.candidates[0])} disabled={busy}
                            className="text-[0.6875rem] px-2 py-0.5 rounded bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-40">이 계산서 연결</button>
                        </div>
                      )}
                      {canEdit && r.vendor_id ? (
                        <button onClick={() => setLinkFor({ id: r.vendor_id!, name: r.customer_name })}
                          className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">직접 찾기</button>
                      ) : (
                        <Link href={`/orders/${r.order_id}`} className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">주문 열기</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <p className="text-[0.6875rem] text-gray-400 mt-3 leading-relaxed">
        홈택스에 없음은 계산서 파일이 아직 올라오지 않았거나 주문과 연결되지 않은 경우입니다. 증빙 없음은 발행 누락 후보이며, 카드 · 선결제로 받은 주문은 대상이 아닙니다.
      </p>

      {linkFor && (
        <InvoiceLinkModal vendorId={linkFor.id} vendorName={linkFor.name}
          onClose={() => { setLinkFor(null); load() }} onApplied={() => {}} />
      )}
      {ask && (
        <BillingAskDialog ask={ask.ask} amount={ask.amount} busy={busy}
          onChoose={c => {
            if (c === 'cancel') { setAsk(null); return }
            save(ask.links, c === 'link_set' && ask.ask.invoiceVendorId ? { vendorId: ask.ask.orderVendorId, billingVendorId: ask.ask.invoiceVendorId } : undefined)
          }} />
      )}
    </div>
  )
}
