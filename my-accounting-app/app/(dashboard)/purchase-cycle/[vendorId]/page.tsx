'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { CandidateModal, won } from '../candidate-modal'
import { ReviewBadge, type ReviewInfo } from '../review-badge'

// 거래처 진행상태 — 파이프라인 (설계 §3)
// ERP 주문 ─▶ 세금계산서 ─▶ 지급 흐름을 거래처 하나에 대해 보여주고,
// 월별 셀을 세로로 쌓아 클릭하면 근거 레코드(원본 드릴다운)까지 내려간다.

type Severity = '정상 대기' | '주의' | '확인 필요'
interface Judgement {
  status: string; severity: Severity; gap: number
  detail: string; cause: string | null
  erp_amount: number; invoice_supply: number; paid_amount: number
  month: string
  review: ReviewInfo | null
}
interface MonthRow {
  month: string
  erp_amount: number; erp_items: number
  invoice_supply: number; invoice_count: number
  paid_amount: number
  judgement: Judgement | null
}
interface Totals { erp: number; erp_items: number; invoice: number; invoice_total: number; invoice_count: number; paid: number }
interface MonthDetail {
  erp_items: { id: string; order_date: string | null; item_name: string | null; quantity: number | null; purchase_total: number; settlement_month: string | null }[]
  invoices: { id: string; issue_date: string; item_name: string | null; supply_amount: number; total_amount: number; payment_status: string }[]
  payments: { transaction_id: string; tx_date: string; description: string | null; amount: number; source: string }[]
}

const STATUS_BADGE: Record<string, string> = {
  '계산서 대기': 'bg-amber-100 text-amber-800',
  '지급 대기': 'bg-blue-100 text-blue-800',
  '금액 차이': 'bg-rose-100 text-rose-800',
  '과다 지급': 'bg-purple-100 text-purple-800',
  '완료': 'bg-green-100 text-green-700',
  '경비성': 'bg-emerald-100 text-emerald-700',
}
const SEV_BADGE: Record<Severity, string> = {
  '확인 필요': 'bg-red-600 text-white',
  '주의': 'bg-orange-400 text-white',
  '정상 대기': 'bg-gray-200 text-gray-600',
}

const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export default function VendorCyclePage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400 text-sm">로딩 중...</div>}>
      <VendorCycleInner />
    </Suspense>
  )
}

function VendorCycleInner() {
  const { vendorId } = useParams<{ vendorId: string }>()
  const sp = useSearchParams()
  const now = new Date()
  const [monthFrom, setMonthFrom] = useState(() => sp.get('from') ?? monthStr(new Date(now.getFullYear() - 1, now.getMonth(), 1)))
  const [monthTo, setMonthTo] = useState(() => sp.get('to') ?? monthStr(now))

  const [vendorName, setVendorName] = useState('')
  const [totals, setTotals] = useState<Totals | null>(null)
  const [months, setMonths] = useState<MonthRow[]>([])
  const [vendorLevel, setVendorLevel] = useState<Judgement[]>([])
  const [reviewsAvailable, setReviewsAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, MonthDetail | 'loading'>>({})
  const [showModal, setShowModal] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExpanded(null)
    setDetails({})
    const res = await fetch(`/api/purchase-cycle/vendor?vendorId=${vendorId}&from=${monthFrom}&to=${monthTo}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setLoading(false); return }
    setVendorName(json.vendor?.name ?? '')
    setTotals(json.totals ?? null)
    setMonths(json.months ?? [])
    setVendorLevel(json.vendorLevel ?? [])
    setReviewsAvailable(!!json.reviews_available)
    setLoading(false)
  }, [vendorId, monthFrom, monthTo])

  useEffect(() => { load() }, [load])

  const toggleMonth = async (month: string) => {
    if (expanded === month) { setExpanded(null); return }
    setExpanded(month)
    if (!details[month]) {
      setDetails(prev => ({ ...prev, [month]: 'loading' }))
      const res = await fetch(`/api/purchase-cycle/month-detail?vendorId=${vendorId}&month=${month}`, { cache: 'no-store' })
      const json = await res.json()
      setDetails(prev => ({ ...prev, [month]: res.ok ? json : { erp_items: [], invoices: [], payments: [] } }))
    }
  }

  const review = async (j: Judgement) => {
    const key = `${j.month}|${j.status}`
    setReviewing(key)
    const res = await fetch('/api/purchase-cycle/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorId, month: j.month, status: j.status,
        erp: j.erp_amount, invoice: j.invoice_supply, paid: j.paid_amount,
      }),
    })
    const json = await res.json()
    setReviewing(null)
    if (!res.ok) { showMsg(json.error ?? '확인 기록 실패'); return }
    showMsg(`${j.month} ${j.status} — 확인을 기록했습니다.`)
    load()
  }

  // 지급 비교는 부가세 포함 총액 기준 (지급이 총액으로 이뤄지므로)
  const unpaid = totals ? Math.max(0, totals.invoice_total - totals.paid) : 0
  const erpInvGap = totals ? totals.erp - totals.invoice : 0
  // 롤업 배지: 거래처 단위 예외가 있으면 그중 최악, 없으면 월별 판정 중 최악 (설계 §2-0)
  const sevOrder: Record<Severity, number> = { '확인 필요': 0, '주의': 1, '정상 대기': 2 }
  const worst = [...vendorLevel, ...months.map(m => m.judgement).filter((j): j is Judgement => !!j && j.status !== '완료' && j.status !== '경비성')]
    .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity])[0] ?? null

  const stage = (label: string, main: string, sub: string, blocked: boolean) => (
    <div className={`flex-1 border rounded-xl p-4 ${blocked ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{main}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </div>
  )
  const arrow = (blocked: boolean) => (
    <div className={`px-1 text-2xl ${blocked ? 'text-orange-500 font-bold' : 'text-gray-300'}`}>→</div>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/purchase-cycle" className="text-sm text-gray-500 hover:text-gray-900">← 매입 사이클 예외 관리</Link>

      <div className="flex items-start justify-between mt-2 mb-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{vendorName || '거래처 진행상태'}</h1>
          {worst && (
            <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_BADGE[worst.status] ?? 'bg-gray-100'}`}>{worst.status}</span>
          )}
          {!worst && !loading && totals && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">이상 없음</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/vendors/${vendorId}`} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">거래처 상세</Link>
          <Link href={`/transactions?vendorId=${vendorId}`} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">통장 거래</Link>
          <button onClick={() => setShowModal(true)}
            className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-700">지급 후보</button>
        </div>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 mt-2 px-4 py-2.5 bg-red-600 text-white text-sm rounded-lg">{error}</div>}

      {/* 기간 */}
      <div className="flex items-center gap-2 my-3">
        <input type="month" value={monthFrom} onChange={e => setMonthFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="month" value={monthTo} onChange={e => setMonthTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">불러오는 중...</p>
      ) : totals && (
        <>
          {/* 파이프라인: 단계 사이 화살표에 막힘 표시 (설계 §3) */}
          <div className="flex items-center gap-1 mb-3">
            {stage('ERP 주문 (매입)', won(totals.erp), `품목 ${totals.erp_items.toLocaleString()}건`, false)}
            {arrow(Math.abs(erpInvGap) > Math.max(totals.erp, totals.invoice, 1) * 0.10 && totals.erp > 0)}
            {stage('세금계산서 (공급가)', won(totals.invoice), `계산서 ${totals.invoice_count.toLocaleString()}건 · 부가세 포함 ${won(totals.invoice_total)}`,
              totals.erp > 0 && totals.invoice < totals.erp * 0.90)}
            {arrow(unpaid > totals.invoice_total * 0.05 && totals.invoice_total > 0)}
            {stage('지급', won(totals.paid),
              unpaid > 0 ? `미지급 잔액 ${won(unpaid)} (총액 기준)` : '지급 완료 수준',
              totals.invoice_total > 0 && totals.paid < totals.invoice_total * 0.95)}
          </div>

          {/* 거래처 단위 예외 (지급 대기 · 과다 지급) */}
          {vendorLevel.map((v, i) => (
            <div key={i} className="flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2.5 mb-2 bg-white text-sm">
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[v.status] ?? 'bg-gray-100'}`}>{v.status}</span>
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${SEV_BADGE[v.severity]}`}>{v.severity}</span>
              <span className="text-gray-700 text-xs">{v.detail}</span>
              {v.cause && <span className="text-gray-400 text-xs">· {v.cause}</span>}
              <span className="ml-auto inline-flex items-center gap-1.5">
                <ReviewBadge review={v.review} />
                {reviewsAvailable && (!v.review || v.review.stale) && (
                  <button onClick={() => review(v)} disabled={reviewing === `${v.month}|${v.status}`}
                    className="px-2 py-1 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-100 disabled:opacity-50">
                    확인
                  </button>
                )}
              </span>
            </div>
          ))}

          {/* 월별 셀 (클릭 = 근거 레코드 드릴다운) */}
          <div className="overflow-x-auto border border-gray-200 rounded-lg mt-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left w-24">월</th>
                  <th className="px-3 py-2 text-left w-28">상태</th>
                  <th className="px-3 py-2 text-right">ERP 매입</th>
                  <th className="px-3 py-2 text-right">계산서</th>
                  <th className="px-3 py-2 text-right">지급</th>
                  <th className="px-3 py-2 text-left">비고 (추정 원인)</th>
                  <th className="px-3 py-2 w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {months.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-sm">이 기간에 매입 데이터가 없습니다.</td></tr>
                )}
                {months.map(mrow => {
                  const j = mrow.judgement
                  const det = details[mrow.month]
                  return [
                    <tr key={mrow.month} className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleMonth(mrow.month)}>
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                        <span className="text-gray-400 mr-1">{expanded === mrow.month ? '▾' : '▸'}</span>{mrow.month}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {j ? (
                          <span className="inline-flex items-center gap-1">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[j.status] ?? 'bg-gray-100'}`}>{j.status}</span>
                            {j.status !== '완료' && j.status !== '경비성' && (
                              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${SEV_BADGE[j.severity]}`}>{j.severity}</span>
                            )}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500">지급만</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{mrow.erp_amount ? won(mrow.erp_amount) : <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{mrow.invoice_supply ? won(mrow.invoice_supply) : <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{mrow.paid_amount ? won(mrow.paid_amount) : <span className="text-gray-300">-</span>}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{j?.cause ?? ''}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {j && (
                          <span className="inline-flex items-center gap-1.5">
                            <ReviewBadge review={j.review} />
                            {reviewsAvailable && (!j.review || j.review.stale) && (
                              <button onClick={() => review(j)} disabled={reviewing === `${j.month}|${j.status}`}
                                className="px-2 py-1 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-100 disabled:opacity-50">
                                확인
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>,
                    expanded === mrow.month && (
                      <tr key={`${mrow.month}-detail`}>
                        <td colSpan={7} className="px-4 py-3 bg-gray-50">
                          {det === 'loading' || !det ? (
                            <p className="text-gray-400 text-xs py-2">근거 레코드 불러오는 중...</p>
                          ) : (
                            <div className="grid grid-cols-3 gap-4 text-xs">
                              <div>
                                <p className="text-gray-500 font-medium mb-1.5">ERP 품목 ({det.erp_items.length}건)</p>
                                {det.erp_items.length === 0 && <p className="text-gray-400">없음</p>}
                                <div className="space-y-1 max-h-56 overflow-y-auto">
                                  {det.erp_items.map(it => (
                                    <p key={it.id} className="text-gray-700">
                                      {(it.order_date ?? '').slice(5, 10)} · {(it.item_name ?? '-').slice(0, 16)} × {it.quantity ?? 0} · {won(it.purchase_total)}
                                      {it.settlement_month && <span className="text-gray-400"> (정산 {it.settlement_month})</span>}
                                    </p>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="text-gray-500 font-medium mb-1.5">세금계산서 ({det.invoices.length}건)</p>
                                {det.invoices.length === 0 && <p className="text-gray-400">없음</p>}
                                <div className="space-y-1 max-h-56 overflow-y-auto">
                                  {det.invoices.map(inv => (
                                    <p key={inv.id}>
                                      <Link href={`/source/tax_invoice/${inv.id}`} className="text-blue-700 hover:underline">
                                        {inv.issue_date.slice(5, 10)} · {(inv.item_name ?? '-').slice(0, 16)} · 공급가 {won(inv.supply_amount)}
                                      </Link>
                                      <span className="text-gray-400"> {inv.payment_status === 'matched' ? '(결제확인)' : ''}</span>
                                    </p>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="text-gray-500 font-medium mb-1.5">지급 ({det.payments.length}건)</p>
                                {det.payments.length === 0 && <p className="text-gray-400">없음</p>}
                                <div className="space-y-1 max-h-56 overflow-y-auto">
                                  {det.payments.map((p, pi) => (
                                    <p key={pi}>
                                      <Link href={`/source/bank/${p.transaction_id}`} className="text-blue-700 hover:underline">
                                        {p.tx_date.slice(5, 10)} · {(p.description ?? '-').slice(0, 16)} · {won(p.amount)}
                                      </Link>
                                      <span className="text-gray-400"> ({p.source})</span>
                                    </p>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 mt-3">
            월을 클릭하면 그 달의 근거 레코드(ERP 품목 · 세금계산서 · 지급)가 펼쳐지고,
            계산서·지급은 원본 상세로 이동할 수 있습니다.
            &lsquo;확인&rsquo;은 잠금이 아니라 기록입니다 — 이후 금액이 바뀌면 자동으로 재검토 필요로 표시됩니다.
          </p>
        </>
      )}

      {showModal && (
        <CandidateModal
          vendorId={vendorId} vendorName={vendorName}
          onClose={() => setShowModal(false)}
          onApplied={() => { setShowModal(false); showMsg('지급 연결이 확정되었습니다.'); load() }}
        />
      )}
    </div>
  )
}
