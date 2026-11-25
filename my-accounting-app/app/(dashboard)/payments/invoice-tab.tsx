'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { OrderNoLink } from '@/components/payments/OrderPreview'
import InvoiceLinkModal from '../sales-cycle/invoice-link-modal'
import { BillingAskDialog, saveInvoiceLinks, type BillingAsk, type InvoiceLink } from '../sales-cycle/billing-ask'
import { btnCls, chipCls, fieldBox } from '@/components/ui/kit'
import { Modal } from '@/components/ui/modal'
import ReasonPicker, { reasonReady, type ReasonValue } from '@/components/payments/ReasonPicker'

// 증빙 없이 처리됨 (1310, 2026-11-25 — 시안 docs/mockups/증빙없이처리_현금매출_시안.html)
type NeVat = 'taxable' | 'exempt' | 'mixed'
interface Done {
  order_id: string; order_no: string | null; order_date: string; customer_name: string; vendor_id: string | null
  paid_date: string; amount: number; vat_kind: NeVat; taxable_amount: number; exempt_amount: number
  supply: number; tax: number; reason_text: string; created_by_name: string | null; created_at: string; evidence_appeared: boolean
}
const NE_VAT: Record<NeVat, string> = { taxable: '과세', exempt: '면세', mixed: '과세 · 면세 섞임' }
const splitTaxable = (n: number) => { const supply = Math.round(n / 1.1); return { supply, tax: n - supply } }

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
  record_vat?: 'taxable' | 'exempt' | 'mixed' | null; other_kind_count?: number
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
  const [done, setDone] = useState<Done[]>([])
  const [neAvail, setNeAvail] = useState(true)
  const [showDone, setShowDone] = useState(false)
  const [neFor, setNeFor] = useState<Row | null>(null)        // 증빙 없이 처리 창
  const [neVat, setNeVat] = useState<NeVat>('taxable')
  const [neTaxable, setNeTaxable] = useState('')
  const [neReason, setNeReason] = useState<ReasonValue | null>(null)
  const [relFor, setRelFor] = useState<Done | null>(null)     // 해제 창
  const [relReason, setRelReason] = useState<ReasonValue | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch('/api/payment-records/invoice-check')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error ?? '조회 실패'); setRows([]) }
    else { setRows(json.rows ?? []); setLatest(json.latest_invoice ?? null); setCanEdit(!!json.can_edit); setCanSetBilling(!!json.can_set_billing); setDone(json.done ?? []); setNeAvail(json.no_evidence_available !== false) }
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
  const openNe = (r: Row) => { setNeFor(r); setNeVat('taxable'); setNeTaxable(''); setNeReason(null) }
  const neAmount = neFor?.paid_amount ?? 0
  const neTaxNum = Math.round(Number(neTaxable.replace(/,/g, '')))
  const neReady = !!neFor && reasonReady(neReason) && (neVat !== 'mixed' || (Number.isFinite(neTaxNum) && neTaxNum > 0 && neTaxNum < neAmount))
  const submitNe = async () => {
    if (!neFor || !neReady) return
    setBusy(true); setMsg(null)
    const res = await fetch('/api/payment-records/no-evidence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: neFor.order_id, vat_kind: neVat, taxable_amount: neVat === 'mixed' ? neTaxNum : null, reason: neReason }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(j.error ?? '처리 실패'); return }
    setMsg(`증빙 없이 처리했습니다 — 주문 ${neFor.order_no ?? ''} · 입금 ${j.deposits}건 ${won(j.amount ?? 0)}원${j.confirmed ? `, 그중 ${j.confirmed}건을 상품매출로 확정` : ''}.${j.journal_errors?.length ? ` 분개 확인 필요: ${j.journal_errors.join(' / ')}` : ''}`)
    setNeFor(null); load()
  }
  const submitRelease = async () => {
    if (!relFor || !reasonReady(relReason)) return
    setBusy(true); setMsg(null)
    const res = await fetch('/api/payment-records/no-evidence', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: relFor.order_id, reason: relReason }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(j.error ?? '해제 실패'); return }
    setMsg(`해제했습니다 — 주문 ${relFor.order_no ?? ''}${j.restored ? `, 이 처리로 확정했던 입금 ${j.restored}건을 처리 전 분류로 되돌렸습니다` : ''}.`)
    setRelFor(null); setRelReason(null); load()
  }
  const doneShown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return done.filter(d => !q || [d.customer_name, d.order_no].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [done, search])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => (issue === 'all' || r.issue === issue)
      && (!q || [r.customer_name, r.billing_name, r.order_no].some(v => (v ?? '').toLowerCase().includes(q))))
  }, [rows, issue, search])

  const chip = (k: Issue | 'all', label: string, n: number) => (
    <button onClick={() => setIssue(issue === k ? 'all' : k)}
      className={chipCls(issue === k)}>{label} {n}</button>
  )

  return (
    <div className="w-full">
      <p className="text-sm text-slate-600 mb-3">
        계산서를 발행했다고 기록했는데 홈택스 계산서가 없는 주문, 금액이 다른 주문, 이체로 받았는데 증빙이 없는 주문입니다.
        <span className="text-slate-500"> 매출 계산서 최신일 {latest ?? '없음'}</span>
      </p>
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {chip('all', '전체', rows.length)}
        {chip('no_hometax', '홈택스에 없음', count('no_hometax'))}
        {chip('amount_diff', '금액 다름', count('amount_diff'))}
        {chip('no_evidence', '입금 받았는데 증빙 없음', count('no_evidence'))}
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button onClick={() => setShowDone(v => !v)} className={chipCls(showDone)}>증빙 없이 처리됨 {done.length}{done.some(d => d.evidence_appeared) && ' · 해제 필요 있음'}</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매출처 · 청구처 · 주문번호 검색"
          className={fieldBox({ noWidth: true, extra: 'ml-auto w-64' })} />
      </div>

      {!neAvail && <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">1310 마이그레이션(증빙 없이 처리)이 아직 적용되지 않았습니다. SQL 편집기에서 1310_order_no_evidence.sql을 실행하면 증빙 없이 처리를 쓸 수 있습니다.</div>}
      {showDone ? (
        <div className="bg-white border border-slate-300 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[56rem]">
            <thead>
              <tr className="text-left">
                <th className="py-2.5 px-3">입금일</th><th className="py-2.5 px-3">주문</th><th className="py-2.5 px-3">매출처</th>
                <th className="py-2.5 px-3 text-right">입금</th><th className="py-2.5 px-3">과세 구분</th><th className="py-2.5 px-3 text-right">공급가 / 세액</th>
                <th className="py-2.5 px-3">사유 · 처리</th><th className="py-2.5 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {doneShown.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-slate-500">증빙 없이 처리된 주문이 없습니다.</td></tr>
              ) : doneShown.map(d => (
                <tr key={d.order_id} className="border-b border-slate-200 align-top">
                  <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">{d.paid_date}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap"><OrderNoLink id={d.order_id} no={d.order_no} /></td>
                  <td className="py-2.5 px-3">{d.customer_name}
                    {d.evidence_appeared && <div><span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700" title="처리한 뒤 계산서 또는 현금영수증이 연결됐습니다 — 매출 · 부가세가 두 번 잡히지 않게 해제하세요">증빙 생김 — 해제 필요</span></div>}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{won(d.amount)}</td>
                  <td className="py-2.5 px-3 text-xs whitespace-nowrap">{NE_VAT[d.vat_kind]}{d.vat_kind === 'mixed' && <div className="text-slate-600">과세 {won(d.taxable_amount)} · 면세 {won(d.exempt_amount)}</div>}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap text-xs">{d.taxable_amount > 0 ? `${won(d.supply)} / ${won(d.tax)}` : '— (면세)'}</td>
                  <td className="py-2.5 px-3 text-xs">{d.reason_text}<div className="text-slate-600">{d.created_by_name ?? '-'} · {d.created_at.slice(5, 16).replace('T', ' ')}</div></td>
                  <td className="py-2.5 px-3 text-right">{canEdit && <button onClick={() => { setRelFor(d); setRelReason(null) }} className={btnCls('secondary', 'sm')}>해제</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loading ? <div className="text-center py-20 text-slate-500">불러오는 중...</div>
        : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm">{rows.length === 0 ? '확인할 주문이 없습니다.' : '조건에 맞는 주문이 없습니다.'}</div>
        ) : (
          <div className="bg-white border border-slate-300 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[56rem]">
              <thead>
                <tr className="text-left text-xs text-slate-600 border-b border-slate-300 bg-slate-50">
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
                  <tr key={`${r.issue}:${r.order_id}`} className="border-b border-slate-200 align-top hover:bg-slate-50">
                    <td className="py-2.5 px-3"><span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-semibold ${ISSUE[r.issue].cls}`}>{ISSUE[r.issue].label}</span></td>
                    <td className="py-2.5 px-3 whitespace-nowrap tabular-nums">
                      {r.order_date}
                      <div className="text-xs"><OrderNoLink id={r.order_id} no={r.order_no} /></div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-slate-900">{r.customer_name || '-'}</div>
                      {r.billing_name && <div className="text-xs text-slate-600">청구처 {r.billing_name}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{won(r.net)}</td>
                    <td className="py-2.5 px-3 text-xs">
                      {r.issue === 'no_evidence' ? (<>
                        <div className="text-slate-800">이체 {r.paid_date?.slice(5)} 통장 입금 {won(r.paid_amount ?? 0)}원 매칭됨</div>
                        <div className="text-slate-500">계산서 · 현금영수증 연결 없음</div>
                      </>) : (<>
                        <div className="text-slate-800">계산서 {r.record_date?.slice(5)} 발행 기록 {won(r.record_amount ?? 0)}원
                          {r.record_vat && <span className="ml-1 px-1.5 py-px rounded-full border border-slate-300 text-xs text-slate-600">{r.record_vat === 'mixed' ? '과세 · 면세' : r.record_vat === 'exempt' ? '면세' : '과세'}</span>}
                        </div>
                        {r.issue === 'no_hometax'
                          ? <div className="text-slate-500">홈택스 계산서 미연결</div>
                          : <div className="text-red-600">홈택스 계산서 {won(r.invoice_amount)}원 — {won(Math.abs(r.invoice_amount - (r.record_amount ?? 0)))}원 다름</div>}
                      </>)}
                      {/* 후보: 금액이 같고 날짜가 가까운 계산서 (다른 거래처 명의 포함). 하나뿐일 때만 바로 연결 */}
                      {r.candidate_count === 1 && (
                        <div className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5">
                          <span className="inline-block px-1.5 py-px rounded bg-green-100 text-green-800 text-xs font-semibold mr-1">후보</span>
                          <b className="text-slate-900">{r.candidates[0].vendor_name}</b> 명의 계산서 {r.candidates[0].issue_date.slice(5, 10)} · {won(r.candidates[0].remaining)}원
                          <div className="text-xs text-slate-600">금액 같음 · {r.candidates[0].foreign ? '다른 거래처 명의' : '이 매출처 계산서'} · 다른 주문에 연결 안 됨</div>
                        </div>
                      )}
                      {(r.other_kind_count ?? 0) > 0 && (
                        <div className="mt-1 text-xs text-amber-700">
                          금액이 같은 {r.record_vat === 'exempt' ? '과세' : '면세'} 계산서 {r.other_kind_count}건 있음(구분 다름 — 후보에서 제외)
                        </div>
                      )}
                      {r.candidate_count > 1 && (
                        <div className="mt-1.5 rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-slate-700">
                          <span className="inline-block px-1.5 py-px rounded bg-slate-200 text-slate-800 text-xs font-semibold mr-1">후보 {r.candidate_count}건</span>
                          금액이 같은 계산서가 여러 장 있습니다 — 직접 찾기로 골라 주세요
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {canEdit && r.candidate_count === 1 && (
                        <div className="mb-1">
                          <button onClick={() => linkCandidate(r, r.candidates[0])} disabled={busy}
                            className={btnCls('primary', 'sm')}>이 계산서 연결</button>
                        </div>
                      )}
                      {canEdit && neAvail && r.issue === 'no_evidence' && (
                        <div className="mb-1">
                          <button onClick={() => openNe(r)} disabled={busy} className={btnCls('primary', 'sm')}>증빙 없이 처리</button>
                        </div>
                      )}
                      {canEdit && r.vendor_id ? (
                        <button onClick={() => setLinkFor({ id: r.vendor_id!, name: r.customer_name })}
                          className={btnCls('secondary', 'sm')}>직접 찾기</button>
                      ) : (
                        <Link href={`/orders/${r.order_id}`} className={btnCls('secondary', 'sm')}>주문 열기</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
        홈택스에 없음은 계산서 파일이 아직 올라오지 않았거나 주문과 연결되지 않은 경우입니다. 증빙 없음은 발행 누락 후보이며, 카드 · 선결제로 받은 주문은 대상이 아닙니다.
      </p>

      {neFor && (
        <Modal title={`증빙 없이 처리 — ${neFor.order_no ?? ''} · ${neFor.customer_name}`} onClose={() => setNeFor(null)}
          desc={<>통장 입금 {neFor.paid_date ?? ''} {won(neAmount)}원 · 계산서 · 현금영수증 없음. 처리하면 분류 전인 입금을 <b>상품매출(4001)</b>로 확정하고 분개를 만듭니다. 과세분은 예상 부가세 <b>현금 매출</b>에 입금일 달로 자동으로 들어갑니다.</>}
          footer={<>
            <button onClick={() => setNeFor(null)} className={btnCls('secondary')}>닫기</button>
            <button onClick={submitNe} disabled={!neReady || busy} className={btnCls('primary')}>증빙 없이 처리</button>
          </>}>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">과세 구분</div>
              <div className="flex gap-1.5 flex-wrap">
                {(['taxable', 'exempt', 'mixed'] as NeVat[]).map(k => <button key={k} onClick={() => setNeVat(k)} className={chipCls(neVat === k)}>{NE_VAT[k]}</button>)}
              </div>
              {neVat === 'taxable' && <div className="text-xs text-slate-600 mt-1">공급가 {won(splitTaxable(neAmount).supply)} · 세액 {won(splitTaxable(neAmount).tax)} (입금액 ÷ 1.1, 원 단위 반올림)</div>}
              {neVat === 'exempt' && <div className="text-xs text-slate-600 mt-1">면세분은 부가세 신고 줄에 넣지 않고 예상 부가세 화면에 &quot;면세 수입금액(참고)&quot;으로 보여 줍니다.</div>}
              {neVat === 'mixed' && (
                <div className="mt-1.5 space-y-1 text-xs text-slate-700">
                  <label className="flex items-center gap-2">과세분
                    <input value={neTaxable} onChange={e => setNeTaxable(e.target.value)} inputMode="numeric" placeholder="부가세 포함 금액" className={fieldBox({ noWidth: true, size: 'sm', extra: 'w-32 text-right' })} />
                    {Number.isFinite(neTaxNum) && neTaxNum > 0 && <span className="text-slate-600">공급가 {won(splitTaxable(neTaxNum).supply)} · 세액 {won(splitTaxable(neTaxNum).tax)}</span>}
                  </label>
                  <div>면세분 = 입금 합계 − 과세분 = <b>{Number.isFinite(neTaxNum) && neTaxNum > 0 ? won(Math.max(0, neAmount - neTaxNum)) : '-'}</b></div>
                  {Number.isFinite(neTaxNum) && neTaxNum >= neAmount && <div className="text-red-600">과세분은 입금 합계({won(neAmount)}원)보다 작아야 합니다 — 전액 과세면 &quot;과세&quot;를 고르세요.</div>}
                </div>
              )}
            </div>
            <ReasonPicker kind="no_evidence" value={neReason} onChange={setNeReason} label="사유" />
          </div>
        </Modal>
      )}
      {relFor && (
        <Modal title={`증빙 없이 처리 해제 — ${relFor.order_no ?? ''}`} onClose={() => setRelFor(null)}
          desc="처리 기록을 해제합니다. 이 처리로 상품매출로 확정했던 입금은 처리 전 분류로 되돌리고 분개도 취소합니다(처리 전에 이미 상품매출이었던 입금은 그대로). 예상 부가세 현금 매출에서도 빠집니다."
          footer={<>
            <button onClick={() => setRelFor(null)} className={btnCls('secondary')}>닫기</button>
            <button onClick={submitRelease} disabled={!reasonReady(relReason) || busy} className={btnCls('primary')}>해제</button>
          </>}>
          <ReasonPicker kind="no_evidence_release" value={relReason} onChange={setRelReason} label="해제 사유" />
        </Modal>
      )}
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
