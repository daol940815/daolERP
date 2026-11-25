'use client'

import { useEffect, useMemo, useState } from 'react'
import { BillingAskDialog, saveInvoiceLinks, type BillingAsk, type InvoiceLink } from './billing-ask'

// 주문 ↔ 계산서 연결 모달 (매출 사이클)
// - 추천 조합: 금액이 정확히 맞는 조합 제시 (후보는 시스템, 확정은 사용자)
// - 직접 연결: 미연결 주문과 미배분 계산서를 나란히 놓고 사용자가 직접 골라 연결
//   (같은 금액 주문이 여러 건이라 자동 짝짓기가 애매한 매출처용)
//   규칙: 주문 1건 + 계산서 N장 또는 주문 N건 + 계산서 1장. 날짜순 waterfall로
//   배분 미리보기를 보여주고, 남는 금액이 있으면 그대로 표시한다(부분 발행 허용).
// - 같은 구분 안에서만(1304, 2026-11-18 — 시안 docs/mockups/같은구분_안에서_찾기_시안.html):
//   고른 주문의 계산서 발행 기록에 과세 구분이 적혀 있으면 다른 종류의 계산서는 접어 둔다("N건 숨김 — 보기", 펼쳐도 고를 수 없음).
//   계산서를 먼저 고르면 반대로 다른 구분으로 기록한 주문이 접힌다. 구분 미기재 · 과세와 면세 기록이 섞인 주문은 걸러내지 않는다. 저장은 서버가 다시 막는다.

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
type Vat = 'taxable' | 'exempt'
const VAT_LABEL: Record<string, string> = { taxable: '과세', exempt: '면세', mixed: '과세 · 면세' }
const VatBadge = ({ v, muted }: { v?: string | null; muted?: boolean }) => v ? (
  <span className={`shrink-0 px-1.5 py-px rounded-full border text-xs whitespace-nowrap ${muted ? 'border-slate-300 text-slate-500' : v === 'exempt' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>{VAT_LABEL[v] ?? v}</span>
) : null

interface Group {
  type: 'exact' | 'combined_orders' | 'split_invoices'
  label: string
  orders: { id: string; order_no: string; order_date: string; remaining: number; vendor_name?: string }[]
  invoices: { id: string; issue_date: string; item_name: string | null; remaining: number; vendor_name?: string }[]
  amount: number
  links: { orderId: string; taxInvoiceId: string; amount: number; issueDate: string }[]
}
interface OpenOrder { id: string; order_no: string; order_date: string; net_amount: number; remaining: number; vendor_name?: string; vat?: Vat | 'mixed' }
// foreign: '다른 거래처 계산서에서 찾기'로 추가한 계산서 (이 매출처 · 청구처가 아닌 거래처 명의, 2026-11-17)
interface OpenInvoice { id: string; issue_date: string; total_amount: number; item_name: string | null; remaining: number; vendor_name?: string; foreign?: boolean; vendor_id?: string | null; counterparty_name?: string | null; tax_type?: string | null }

export default function InvoiceLinkModal({ vendorId, vendorName, from, focusOrderId, focusInvoiceId, onClose, onApplied }: {
  vendorId: string
  vendorName: string
  // 주문 상세에서 열 때 — 그 주문 기준으로 연다(직접 연결에 미리 체크 · 추천 조합은 그 주문이 든 것만, 2026-11-17)
  focusOrderId?: string
  // 계산서 내역에서 열 때 — 그 계산서 기준으로 연다(직접 연결에 미리 체크 · 추천 조합은 그 계산서가 든 것만, 2026-11-17)
  focusInvoiceId?: string
  from?: string   // 주문일 하한 — 화면의 조회 기간과 연동
  onClose: () => void
  onApplied: () => void
}) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [invoices, setInvoices] = useState<OpenInvoice[]>([])
  const [summary, setSummary] = useState<{ open_orders: number; available_invoices: number; coverable_amount: number } | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [selOrders, setSelOrders] = useState<Set<string>>(new Set())
  const [selInvoices, setSelInvoices] = useState<Set<string>>(new Set())
  const [orderQuery, setOrderQuery] = useState('')
  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [focusInvMissing, setFocusInvMissing] = useState(false)   // 지정한 계산서가 미배분 목록에 없음(전액 연결 · 취소쌍 등)
  const [focusMissing, setFocusMissing] = useState(false)   // 지정한 주문이 미연결 목록에 없음(이미 전액 연결 등)
  // 다른 거래처 계산서에서 찾기
  const [billing, setBilling] = useState<{ name: string | null; can_ask: boolean }>({ name: null, can_ask: false })
  const [findOpen, setFindOpen] = useState(false)
  const [findAmount, setFindAmount] = useState('')
  const [findFrom, setFindFrom] = useState('')
  const [findTo, setFindTo] = useState('')
  const [findQ, setFindQ] = useState('')
  const [found, setFound] = useState<OpenInvoice[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [ask, setAsk] = useState<{ ask: BillingAsk; links: InvoiceLink[]; amount: number } | null>(null)
  const [showOtherInv, setShowOtherInv] = useState(false)   // 구분이 다른 계산서 펼치기
  const [showOtherOrd, setShowOtherOrd] = useState(false)   // 구분이 다른 주문 펼치기

  const load = () => {
    setGroups(null)
    fetch(`/api/sales-cycle/invoice-candidates?vendorId=${vendorId}${from ? `&from=${from}` : ''}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setError(j.error ?? '후보 조회 실패'); setGroups([]); return }
        const allGroups = (j.groups ?? []) as Group[]
        const gs = focusOrderId ? allGroups.filter(g => g.orders.some(o => o.id === focusOrderId))
          : focusInvoiceId ? allGroups.filter(g => g.invoices.some(v => v.id === focusInvoiceId)) : allGroups
        const hasFocus = !!focusOrderId && ((j.orders ?? []) as OpenOrder[]).some(o => o.id === focusOrderId)
        const hasFocusInv = !!focusInvoiceId && ((j.invoices ?? []) as OpenInvoice[]).some(v => v.id === focusInvoiceId)
        setGroups(gs)
        setFocusMissing(!!focusOrderId && !hasFocus)
        setFocusInvMissing(!!focusInvoiceId && !hasFocusInv)
        // 지정한 주문 · 계산서가 든 추천이 없으면 직접 연결 탭에서 시작
        if (focusOrderId || focusInvoiceId) setMode(gs.length ? 'auto' : 'manual')
        setOrders(j.orders ?? [])
        setInvoices(j.invoices ?? [])
        setSummary(j.summary ?? null)
        setBilling(j.billing ?? { name: null, can_ask: false })
        setFound(null)
        setChecked(new Set())
        setSelOrders(hasFocus ? new Set([focusOrderId!]) : new Set())
        setSelInvoices(hasFocusInv ? new Set([focusInvoiceId!]) : new Set())
      })
      .catch(() => { setError('네트워크 오류'); setGroups([]) })
  }
  useEffect(load, [vendorId, from, focusOrderId, focusInvoiceId])

  const toggle = (i: number) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })
  const toggleId = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  // ── 같은 구분 안에서만 ──
  // 고른 주문들의 기록 구분이 한 종류면 그 종류의 계산서만, 고른 계산서들이 한 종류면 그 구분(또는 미기재)의 주문만 보여 준다
  const wantTax = useMemo<Vat | null>(() => {
    const set = new Set(orders.filter(o => selOrders.has(o.id) && o.vat && o.vat !== 'mixed').map(o => o.vat as Vat))
    return set.size === 1 ? Array.from(set)[0] : null
  }, [orders, selOrders])
  const wantVat = useMemo<Vat | null>(() => {
    const set = new Set(invoices.filter(v => selInvoices.has(v.id) && (v.tax_type === 'taxable' || v.tax_type === 'exempt')).map(v => v.tax_type as Vat))
    return set.size === 1 ? Array.from(set)[0] : null
  }, [invoices, selInvoices])
  const pairOk = (o: OpenOrder, v: OpenInvoice) => !o.vat || o.vat === 'mixed' || !v.tax_type || o.vat === v.tax_type
  const invBlocked = (v: OpenInvoice) => !!wantTax && !!v.tax_type && v.tax_type !== wantTax
  const ordBlocked = (o: OpenOrder) => !!wantVat && !!o.vat && o.vat !== 'mixed' && o.vat !== wantVat

  // ── 직접 연결: 선택 유효성 + 배분 미리보기 (날짜순 waterfall) ──
  const manualPlan = useMemo(() => {
    const os = orders.filter(o => selOrders.has(o.id))
    const vs = invoices.filter(v => selInvoices.has(v.id))
    if (!os.length || !vs.length) return null
    const clash = os.flatMap(o => vs.filter(v => !pairOk(o, v)).map(v => ({ o, v })))[0]
    if (clash) {
      return { valid: false as const, message: `주문 ${clash.o.order_no}의 결제 기록은 ${VAT_LABEL[clash.o.vat!]}인데 계산서(${clash.v.issue_date.slice(0, 10)})는 ${VAT_LABEL[clash.v.tax_type!] ?? clash.v.tax_type}입니다. 구분이 다르면 연결할 수 없습니다 — 기록을 잘못 적었으면 주문 상세에서 고치고, 계산서 종류를 잘못 발행했으면 수정 발행해야 합니다.` }
    }
    if (os.length > 1 && vs.length > 1) {
      return { valid: false as const, message: '주문 여러 건 + 계산서 여러 장 조합은 지원하지 않습니다. 한쪽은 1건만 선택하세요.' }
    }
    const links: { orderId: string; taxInvoiceId: string; amount: number; issueDate: string; label: string }[] = []
    if (os.length === 1) {
      // 주문 1건에 계산서들을 발행일순으로 충당
      let capacity = os[0].remaining
      for (const v of [...vs].sort((a, b) => a.issue_date.localeCompare(b.issue_date))) {
        const amt = Math.min(v.remaining, capacity)
        if (amt > 0) {
          links.push({ orderId: os[0].id, taxInvoiceId: v.id, amount: amt, issueDate: v.issue_date, label: `계산서 ${v.issue_date} → 주문 ${os[0].order_no}` })
          capacity -= amt
        }
      }
      const linked = links.reduce((s, l) => s + l.amount, 0)
      return {
        valid: links.length > 0, message: links.length === 0 ? '주문 잔액이 없어 배분할 수 없습니다.' : null,
        links, linked,
        leftOrder: os[0].remaining - linked,
        leftInvoice: vs.reduce((s, v) => s + v.remaining, 0) - linked,
      }
    }
    // 계산서 1장을 주문들(주문일순)에 배분
    let left = vs[0].remaining
    for (const o of [...os].sort((a, b) => a.order_date.localeCompare(b.order_date))) {
      const amt = Math.min(o.remaining, left)
      if (amt > 0) {
        links.push({ orderId: o.id, taxInvoiceId: vs[0].id, amount: amt, issueDate: vs[0].issue_date, label: `계산서 ${vs[0].issue_date} → 주문 ${o.order_no}` })
        left -= amt
      }
    }
    const linked = links.reduce((s, l) => s + l.amount, 0)
    return {
      valid: links.length > 0, message: links.length === 0 ? '선택한 주문에 잔액이 없습니다.' : null,
      links, linked,
      leftOrder: os.reduce((s, o) => s + o.remaining, 0) - linked,
      leftInvoice: vs[0].remaining - linked,
    }
  }, [orders, invoices, selOrders, selInvoices])

  const postLinks = async (links: InvoiceLink[], confirmMsg: string | null, setBillingTo?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return
    setApplying(true)
    setError(null)
    setNotice(null)
    const r = await saveInvoiceLinks(links, setBillingTo ? { vendorId, billingVendorId: setBillingTo } : undefined)
    setApplying(false)
    setAsk(null)
    if (!r.ok) { setError(r.message); return }
    setNotice(r.message)
    onApplied()
    load() // 모달을 닫지 않고 다음 연결을 이어서 할 수 있게 갱신
  }

  // 다른 거래처 계산서에서 찾기 — 금액 기본값은 고른 주문의 남은 금액 합, 기간은 주문일 −7일 ~ +120일
  const openFind = () => {
    const os = orders.filter(o => selOrders.has(o.id))
    const base = os.length ? os : orders
    setFindAmount(os.length ? String(os.reduce((x, o) => x + o.remaining, 0)) : '')
    if (base.length) {
      const dates = base.map(o => o.order_date.slice(0, 10)).sort()
      const shift = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10)
      setFindFrom(shift(dates[0], -7)); setFindTo(shift(dates[dates.length - 1], 120))
    }
    setFindQ(''); setFound(null); setFindOpen(true)
  }
  const runFind = async () => {
    setFinding(true); setError(null)
    const p = new URLSearchParams({ vendorId })
    const amt = findAmount.replace(/[^0-9]/g, '')
    if (amt) p.set('amount', amt)
    if (findFrom) p.set('from', findFrom)
    if (findTo) p.set('to', findTo)
    if (findQ.trim()) p.set('q', findQ.trim())
    const res = await fetch(`/api/sales-cycle/invoice-search?${p}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    setFinding(false)
    if (!res.ok) { setError(j.error ?? '찾기 실패'); setFound([]); return }
    setFound(((j.invoices ?? []) as OpenInvoice[]).map(v => ({ ...v, foreign: true })))
  }
  const addFound = (v: OpenInvoice) => {
    setInvoices(prev => (prev.some(x => x.id === v.id) ? prev : [...prev, v]))
    setSelInvoices(prev => new Set(prev).add(v.id))
  }

  const applyAuto = () => {
    if (!groups) return
    const targets = groups.filter((_, i) => checked.has(i))
    if (!targets.length) { setError('선택된 조합이 없습니다.'); return }
    const amount = targets.reduce((s, g) => s + g.amount, 0)
    postLinks(targets.flatMap(g => g.links), `${targets.length}개 조합(${won(amount)})의 주문-계산서 연결을 확정합니다.`)
  }

  const applyManual = () => {
    if (!manualPlan || !manualPlan.valid || !manualPlan.links) return
    const links = manualPlan.links.map(({ orderId, taxInvoiceId, amount, issueDate }) => ({ orderId, taxInvoiceId, amount, issueDate }))
    // 다른 거래처 명의 계산서가 섞여 있으면 묻는 창을 띄운다 — 청구처로 지정하면 다음부터 추천에 뜬다
    const foreign = invoices.filter(v => v.foreign && links.some(l => l.taxInvoiceId === v.id))
    if (foreign.length) {
      const vendors = Array.from(new Set(foreign.map(v => v.vendor_id ?? '')))
      const one = vendors.length === 1 && vendors[0] ? foreign[0] : null
      setAsk({
        links, amount: manualPlan.linked ?? 0,
        ask: {
          orderVendorId: vendorId, orderVendorName: vendorName,
          invoiceVendorId: one?.vendor_id ?? null,
          invoiceVendorName: one ? (one.vendor_name ?? '') : foreign.map(v => v.vendor_name ?? '').filter((x, i, a) => a.indexOf(x) === i).join(', '),
          canSetBilling: !!one && billing.can_ask,
          whyNot: !one ? (vendors.length > 1 ? '서로 다른 거래처의 계산서가 섞여 있어 청구처 지정은 묻지 않습니다. 이번 연결만 저장합니다.' : '거래처가 연결되지 않은 계산서라 청구처 지정은 묻지 않습니다. 이번 연결만 저장합니다.')
            : billing.name ? `이 매출처는 이미 청구처(${billing.name})가 지정되어 있습니다. 이번 연결만 저장합니다.`
              : '청구처 지정은 거래처 관리 수정 권한이 필요하거나, 이 매출처가 다른 매출처의 청구처로 쓰이고 있습니다. 이번 연결만 저장합니다.',
        },
      })
      return
    }
    postLinks(links, `${links.length}건 연결(${won(manualPlan.linked ?? 0)})을 확정합니다.`)
  }

  const filteredOrders = orders.filter(o =>
    !orderQuery.trim() || o.order_no.includes(orderQuery.trim()) || String(o.remaining).includes(orderQuery.replace(/[^0-9]/g, '')))
  const filteredInvoices = invoices.filter(v =>
    !invoiceQuery.trim() || (v.item_name ?? '').includes(invoiceQuery.trim()) || String(v.remaining).includes(invoiceQuery.replace(/[^0-9]/g, '')))
  // 구분이 달라 접어 둔 것 (이미 고른 것은 풀 수 있게 계속 보여 준다)
  const hiddenInv = filteredInvoices.filter(v => invBlocked(v) && !selInvoices.has(v.id))
  const hiddenOrd = filteredOrders.filter(o => ordBlocked(o) && !selOrders.has(o.id))
  const shownInvoices = showOtherInv ? filteredInvoices : filteredInvoices.filter(v => !hiddenInv.includes(v))
  const shownOrders = showOtherOrd ? filteredOrders : filteredOrders.filter(o => !hiddenOrd.includes(o))
  const focusVat = focusOrderId ? orders.find(o => o.id === focusOrderId)?.vat : undefined
  const hiddenBar = (count: number, what: string, why: string, open: boolean, toggle: () => void) => count > 0 && (
    <div className="flex items-center gap-2 flex-wrap px-3 py-1.5 border-t border-dashed border-slate-400 bg-slate-50 text-xs text-slate-700">
      <b>{what} {count}건은 {open ? '연결 불가' : '숨김'}</b><span className="text-slate-500">{why}</span>
      <button type="button" onClick={toggle} className="ml-auto px-2 py-0.5 border border-slate-400 rounded bg-white text-slate-700 hover:bg-slate-50">{open ? '숨기기' : '보기'}</button>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-slate-900">{vendorName} — 주문·계산서 연결</h3>
          {focusVat && focusVat !== 'mixed' && <span className="px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-xs whitespace-nowrap">결제 기록: {VAT_LABEL[focusVat]} — {VAT_LABEL[focusVat]} 계산서만 표시</span>}
          {focusVat === 'mixed' && <span className="px-2 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-700 text-xs whitespace-nowrap">과세 · 면세 기록 모두 있음</span>}
          <div className="flex gap-1 ml-auto">
            {([['auto', '추천 조합'], ['manual', '직접 연결']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-600 mt-1 mb-3">
          {mode === 'auto'
            ? '금액이 정확히 맞는 조합만 제시합니다. 같은 금액 주문이 여러 건이면 짝이 섞일 수 있으니 확인 후 확정하세요.'
            : '주문 1건 + 계산서 여러 장, 또는 계산서 1장 + 주문 여러 건을 직접 골라 연결합니다. 금액이 달라도(부분 발행) 배분됩니다.'}
          {summary && ` · 미연결 주문 ${summary.open_orders}건 · 미배분 계산서 ${summary.available_invoices}장`}
        </p>
        {focusMissing && groups && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
            이 주문은 계산서를 더 연결할 금액이 없습니다(이미 전액 연결됐거나 순매출이 0). 아래는 같은 매출처의 다른 미연결 주문입니다.
          </div>
        )}
        {focusInvMissing && groups && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
            이 계산서는 더 연결할 금액이 없거나(이미 전액 연결) 취소쌍이라 목록에 없습니다. 아래는 같은 거래처의 다른 미배분 계산서입니다.
          </div>
        )}
        {focusInvoiceId && groups && !focusInvMissing && orders.length === 0 && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
            이 거래처(와 이 거래처를 청구처로 둔 매출처)에 계산서가 연결되지 않은 주문이 없습니다. 주문이 다른 매출처에 있다면 그 매출처의 청구처를 이 거래처로 지정하거나, 주문 상세 › 결제 내역의 &quot;계산서 연결&quot;에서 &quot;다른 거래처 계산서에서 찾기&quot;로 연결하세요.
          </div>
        )}
        {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
        {notice && <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg">{notice}</div>}

        {!groups ? (
          <p className="text-slate-500 text-sm py-8 text-center">불러오는 중...</p>
        ) : mode === 'auto' ? (
          <>
            {groups.length === 0 ? (
              <p className="text-slate-500 text-sm py-8 text-center">
                {focusOrderId ? '이 주문과 금액이 맞는 조합이 없습니다.' : focusInvoiceId ? '이 계산서와 금액이 맞는 조합이 없습니다.' : '금액이 맞는 조합이 없습니다.'} [직접 연결] 탭에서 수동으로 연결해주세요.
              </p>
            ) : (
              <div className="space-y-2.5">
                {groups.map((g, i) => (
                  <label key={i} className={`block border rounded-lg p-3 cursor-pointer transition-colors ${checked.has(i) ? 'border-slate-500 bg-slate-50' : 'border-slate-300 hover:border-slate-400'}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                      <span className="text-sm font-semibold text-slate-900">{g.label}</span>
                      <span className="ml-auto text-sm font-bold text-slate-900">{won(g.amount)}</span>
                    </div>
                    <div className="pl-6 text-xs text-slate-700 space-y-0.5">
                      {g.orders.map(o => (
                        <p key={o.id}>주문 {o.order_date.slice(0, 10)} · {o.vendor_name ? `${o.vendor_name} · ` : ''}{o.order_no} · {won(o.remaining)} <VatBadge v={(o as OpenOrder).vat} /></p>
                      ))}
                      {g.invoices.map(v => (
                        <p key={v.id} className="text-indigo-800">
                          계산서 {v.issue_date.slice(0, 10)} · {v.item_name ?? '(품목 미상)'} · {won(v.remaining)} <VatBadge v={(v as OpenInvoice).tax_type} />
                        </p>
                      ))}
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 mt-4">
              <button onClick={applyAuto} disabled={applying || !groups.length || checked.size === 0}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {applying ? '확정 중...' : `선택 ${checked.size}개 조합 확정`}
              </button>
              <button onClick={onClose} className="px-4 py-2 border border-slate-400 rounded-lg text-sm text-slate-800 hover:bg-slate-50">닫기</button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border border-slate-300 rounded-lg">
                <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
                  <p className="text-xs font-semibold text-slate-800">미연결 주문 ({shownOrders.length})</p>
                  <input value={orderQuery} onChange={e => setOrderQuery(e.target.value)} placeholder="주문번호·금액 검색"
                    className="ml-auto border border-slate-300 rounded px-2 py-1 text-xs w-32" />
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-200">
                  {shownOrders.map(o => {
                    const off = hiddenOrd.includes(o)
                    return (
                    <label key={o.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${off ? 'bg-slate-50 text-slate-500' : `cursor-pointer ${selOrders.has(o.id) ? 'bg-slate-50' : 'hover:bg-slate-50'}`}`}>
                      <input type="checkbox" checked={selOrders.has(o.id)} disabled={off} onChange={() => toggleId(selOrders, setSelOrders, o.id)} />
                      <span className="text-slate-600 whitespace-nowrap">{o.order_date.slice(0, 10)}</span>
                      <span className={`truncate ${off ? '' : 'text-slate-900'}`}>{o.vendor_name ? <span className="text-blue-700">{o.vendor_name} · </span> : null}{o.order_no}</span>
                      <VatBadge v={o.vat} muted={off} />
                      {off && <span className="shrink-0 px-1 py-px rounded bg-red-100 text-red-700 text-xs font-semibold whitespace-nowrap">구분 다름</span>}
                      <span className="ml-auto tabular-nums font-medium whitespace-nowrap">{won(o.remaining)}</span>
                    </label>
                    )
                  })}
                  {shownOrders.length === 0 && <p className="text-xs text-slate-500 text-center py-6">{hiddenOrd.length ? '같은 구분의 미연결 주문이 없습니다.' : '미연결 주문이 없습니다.'}</p>}
                </div>
                {hiddenBar(hiddenOrd.length, `${wantVat === 'taxable' ? '면세' : '과세'}로 기록한 주문`, `(고른 계산서는 ${wantVat ? VAT_LABEL[wantVat] : ''})`, showOtherOrd, () => setShowOtherOrd(v => !v))}
              </div>
              <div className="border border-slate-300 rounded-lg">
                <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-indigo-800">미배분 계산서 ({shownInvoices.length})</p>
                  <button onClick={() => (findOpen ? setFindOpen(false) : openFind())}
                    title="계산서가 다른 거래처(지점 · 본점 등) 명의로 발행된 경우, 전체 매출 계산서에서 금액 · 발행일 · 상호로 찾습니다"
                    className="px-2 py-1 rounded border border-blue-300 bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100">
                    {findOpen ? '찾기 닫기' : '다른 거래처 계산서에서 찾기'}
                  </button>
                  <input value={invoiceQuery} onChange={e => setInvoiceQuery(e.target.value)} placeholder="품목·금액 검색"
                    className="ml-auto border border-slate-300 rounded px-2 py-1 text-xs w-28" />
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-200">
                  {shownInvoices.map(v => {
                    const off = hiddenInv.includes(v)
                    return (
                    <label key={v.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${off ? 'bg-slate-50 text-slate-500' : `cursor-pointer ${v.foreign ? 'bg-amber-50' : selInvoices.has(v.id) ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}`}>
                      <input type="checkbox" checked={selInvoices.has(v.id)} disabled={off} onChange={() => toggleId(selInvoices, setSelInvoices, v.id)} />
                      <span className="text-slate-600 whitespace-nowrap">{v.issue_date.slice(0, 10)}</span>
                      <VatBadge v={v.tax_type} muted={off} />
                      {off && <span className="shrink-0 px-1 py-px rounded bg-red-100 text-red-700 text-xs font-semibold whitespace-nowrap">구분 다름</span>}
                      <span className={`truncate ${off ? '' : 'text-slate-900'}`}>
                        {v.foreign
                          ? <span className="inline-block px-1 py-px rounded bg-amber-100 text-amber-800 text-xs font-semibold mr-1">다른 거래처 · {v.vendor_name}</span>
                          : v.vendor_name ? <span className="text-blue-700">{v.vendor_name} · </span> : null}
                        {v.item_name ?? '(품목 미상)'}
                      </span>
                      <span className="ml-auto tabular-nums font-medium whitespace-nowrap">{won(v.remaining)}</span>
                    </label>
                    )
                  })}
                  {shownInvoices.length === 0 && <p className="text-xs text-slate-500 text-center py-6">{hiddenInv.length ? '같은 구분의 미배분 계산서가 없습니다.' : '미배분 계산서가 없습니다.'}</p>}
                </div>
                {hiddenBar(hiddenInv.length, `${wantTax === 'taxable' ? '면세' : '과세'} 계산서`, `(고른 주문의 결제 기록은 ${wantTax ? VAT_LABEL[wantTax] : ''})`, showOtherInv, () => setShowOtherInv(v => !v))}
              </div>
            </div>

            {findOpen && (
              <div className="mt-3 p-3 rounded-lg border border-dashed border-blue-300 bg-blue-50/40">
                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 mb-2">
                  <b className="text-blue-700">다른 거래처 계산서에서 찾기</b>
                  <span>금액</span>
                  <input value={findAmount ? Number(findAmount.replace(/[^0-9]/g, '') || 0).toLocaleString('ko-KR') : ''} onChange={e => setFindAmount(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="전체" inputMode="numeric" className="border border-slate-400 rounded px-2 py-1 w-28 text-right bg-white tabular-nums" />
                  <span>발행일</span>
                  <input type="date" value={findFrom} onChange={e => setFindFrom(e.target.value)} className="border border-slate-400 rounded px-1.5 py-1 bg-white" />
                  <span>~</span>
                  <input type="date" value={findTo} onChange={e => setFindTo(e.target.value)} className="border border-slate-400 rounded px-1.5 py-1 bg-white" />
                  <input value={findQ} onChange={e => setFindQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runFind() }}
                    placeholder="상호 (예: 석계역)" className="border border-slate-400 rounded px-2 py-1 w-36 bg-white" />
                  <button onClick={runFind} disabled={finding} className="px-2.5 py-1 rounded bg-slate-900 text-white font-medium disabled:opacity-50">{finding ? '찾는 중...' : '찾기'}</button>
                </div>
                {found === null ? (
                  <p className="text-xs text-slate-500">금액은 계산서의 남은 금액과 같은 것만 찾습니다. 금액을 비우면 상호로 찾습니다. 이미 다른 주문에 다 연결된 계산서와 취소쌍은 나오지 않습니다.</p>
                ) : found.length === 0 ? (
                  <p className="text-xs text-slate-600">조건에 맞는 계산서가 없습니다. 계산서 파일이 아직 올라오지 않았거나, 금액 · 기간이 다를 수 있습니다.</p>
                ) : (
                  <div className="bg-white border border-slate-300 rounded-lg divide-y divide-slate-200 max-h-48 overflow-y-auto">
                    {found.map(v => {
                      const added = invoices.some(x => x.id === v.id)
                      return (
                        <div key={v.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs flex-wrap">
                          <span className="text-slate-600 tabular-nums">{v.issue_date.slice(0, 10)}</span>
                          <VatBadge v={v.tax_type} />
                          <span className="text-slate-900">{v.counterparty_name ?? '(상호 없음)'}</span>
                          <span className="text-slate-500">거래처 {v.vendor_name}</span>
                          <span className="ml-auto tabular-nums">남은 금액 <b>{won(v.remaining)}</b>{v.remaining !== v.total_amount && <span className="text-slate-500"> / {won(v.total_amount)}</span>}</span>
                          <button onClick={() => addFound(v)} disabled={added || invBlocked(v)}
                            title={invBlocked(v) ? '고른 주문의 결제 기록과 과세 구분이 달라 연결할 수 없습니다' : undefined}
                            className="px-2 py-0.5 border border-slate-400 rounded text-slate-800 hover:bg-slate-50 disabled:opacity-40">{added ? '추가됨' : invBlocked(v) ? '구분 다름' : '목록에 추가'}</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {manualPlan && (
              <div className={`mt-3 px-3 py-2.5 rounded-lg text-xs border ${manualPlan.valid ? 'bg-slate-50 border-slate-300 text-slate-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                {!manualPlan.valid ? (
                  manualPlan.message
                ) : (
                  <>
                    <p className="font-semibold mb-1">배분 미리보기 — 연결 {won(manualPlan.linked ?? 0)}</p>
                    {(manualPlan.links ?? []).map((l, i) => <p key={i}>{l.label} · {won(l.amount)}</p>)}
                    {(manualPlan.leftOrder ?? 0) > 0 && <p className="mt-1 text-amber-700">주문 잔여 {won(manualPlan.leftOrder!)} — 부분 발행으로 남습니다.</p>}
                    {(manualPlan.leftInvoice ?? 0) > 0 && <p className="mt-1 text-amber-700">계산서 잔여 {won(manualPlan.leftInvoice!)} — 다른 주문에 추가 배분할 수 있습니다.</p>}
                  </>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mt-4">
              <button onClick={applyManual} disabled={applying || !manualPlan?.valid}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {applying ? '확정 중...' : '선택 연결 확정'}
              </button>
              <button onClick={() => { setSelOrders(new Set()); setSelInvoices(new Set()) }}
                className="px-3 py-2 border border-slate-400 rounded-lg text-sm text-slate-700 hover:bg-slate-50">선택 해제</button>
              <button onClick={onClose} className="px-4 py-2 border border-slate-400 rounded-lg text-sm text-slate-800 hover:bg-slate-50">닫기</button>
              <span className="text-xs text-slate-500">확정 후에도 모달이 열려 있어 이어서 연결할 수 있습니다.</span>
            </div>
          </>
        )}
      </div>
      {ask && (
        <BillingAskDialog ask={ask.ask} amount={ask.amount} busy={applying}
          onChoose={c => {
            if (c === 'cancel') { setAsk(null); return }
            postLinks(ask.links, null, c === 'link_set' && ask.ask.invoiceVendorId ? ask.ask.invoiceVendorId : undefined)
          }} />
      )}
    </div>
  )
}
