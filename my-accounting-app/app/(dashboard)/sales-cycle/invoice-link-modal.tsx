'use client'

import { useEffect, useMemo, useState } from 'react'

// 주문 ↔ 계산서 연결 모달 (매출 사이클)
// - 추천 조합: 금액이 정확히 맞는 조합 제시 (후보는 시스템, 확정은 사용자)
// - 직접 연결: 미연결 주문과 미배분 계산서를 나란히 놓고 사용자가 직접 골라 연결
//   (같은 금액 주문이 여러 건이라 자동 짝짓기가 애매한 매출처용)
//   규칙: 주문 1건 + 계산서 N장 또는 주문 N건 + 계산서 1장. 날짜순 waterfall로
//   배분 미리보기를 보여주고, 남는 금액이 있으면 그대로 표시한다(부분 발행 허용).

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

interface Group {
  type: 'exact' | 'combined_orders' | 'split_invoices'
  label: string
  orders: { id: string; order_no: string; order_date: string; remaining: number }[]
  invoices: { id: string; issue_date: string; item_name: string | null; remaining: number }[]
  amount: number
  links: { orderId: string; taxInvoiceId: string; amount: number; issueDate: string }[]
}
interface OpenOrder { id: string; order_no: string; order_date: string; net_amount: number; remaining: number }
interface OpenInvoice { id: string; issue_date: string; total_amount: number; item_name: string | null; remaining: number }

export default function InvoiceLinkModal({ vendorId, vendorName, onClose, onApplied }: {
  vendorId: string
  vendorName: string
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
  const [applying, setApplying] = useState(false)

  const load = () => {
    setGroups(null)
    fetch(`/api/sales-cycle/invoice-candidates?vendorId=${vendorId}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setError(j.error ?? '후보 조회 실패'); setGroups([]); return }
        setGroups(j.groups ?? [])
        setOrders(j.orders ?? [])
        setInvoices(j.invoices ?? [])
        setSummary(j.summary ?? null)
        setChecked(new Set())
        setSelOrders(new Set())
        setSelInvoices(new Set())
      })
      .catch(() => { setError('네트워크 오류'); setGroups([]) })
  }
  useEffect(load, [vendorId])

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

  // ── 직접 연결: 선택 유효성 + 배분 미리보기 (날짜순 waterfall) ──
  const manualPlan = useMemo(() => {
    const os = orders.filter(o => selOrders.has(o.id))
    const vs = invoices.filter(v => selInvoices.has(v.id))
    if (!os.length || !vs.length) return null
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

  const postLinks = async (links: { orderId: string; taxInvoiceId: string; amount: number; issueDate: string }[], confirmMsg: string) => {
    if (!confirm(confirmMsg)) return
    setApplying(true)
    setError(null)
    const res = await fetch('/api/sales-cycle/invoice-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    })
    const json = await res.json()
    setApplying(false)
    if (!res.ok) { setError(json.error ?? '확정 실패'); return }
    onApplied()
    load() // 모달을 닫지 않고 다음 연결을 이어서 할 수 있게 갱신
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
    postLinks(manualPlan.links, `${manualPlan.links.length}건 연결(${won(manualPlan.linked ?? 0)})을 확정합니다.`)
  }

  const filteredOrders = orders.filter(o =>
    !orderQuery.trim() || o.order_no.includes(orderQuery.trim()) || String(o.remaining).includes(orderQuery.replace(/[^0-9]/g, '')))
  const filteredInvoices = invoices.filter(v =>
    !invoiceQuery.trim() || (v.item_name ?? '').includes(invoiceQuery.trim()) || String(v.remaining).includes(invoiceQuery.replace(/[^0-9]/g, '')))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-gray-900">{vendorName} — 주문·계산서 연결</h3>
          <div className="flex gap-1 ml-auto">
            {([['auto', '추천 조합'], ['manual', '직접 연결']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${mode === k ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1 mb-3">
          {mode === 'auto'
            ? '금액이 정확히 맞는 조합만 제시합니다. 같은 금액 주문이 여러 건이면 짝이 섞일 수 있으니 확인 후 확정하세요.'
            : '주문 1건 + 계산서 여러 장, 또는 계산서 1장 + 주문 여러 건을 직접 골라 연결합니다. 금액이 달라도(부분 발행) 배분됩니다.'}
          {summary && ` · 미연결 주문 ${summary.open_orders}건 · 미배분 계산서 ${summary.available_invoices}장`}
        </p>
        {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

        {!groups ? (
          <p className="text-gray-400 text-sm py-8 text-center">불러오는 중...</p>
        ) : mode === 'auto' ? (
          <>
            {groups.length === 0 ? (
              <p className="text-gray-400 text-sm py-8 text-center">
                금액이 맞는 조합이 없습니다. [직접 연결] 탭에서 수동으로 연결해주세요.
              </p>
            ) : (
              <div className="space-y-2.5">
                {groups.map((g, i) => (
                  <label key={i} className={`block border rounded-lg p-3 cursor-pointer transition-colors ${checked.has(i) ? 'border-slate-500 bg-slate-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                      <span className="text-sm font-semibold text-gray-900">{g.label}</span>
                      <span className="ml-auto text-sm font-bold text-gray-900">{won(g.amount)}</span>
                    </div>
                    <div className="pl-6 text-xs text-gray-600 space-y-0.5">
                      {g.orders.map(o => (
                        <p key={o.id}>주문 {o.order_date.slice(0, 10)} · {o.order_no} · {won(o.remaining)}</p>
                      ))}
                      {g.invoices.map(v => (
                        <p key={v.id} className="text-indigo-800">
                          계산서 {v.issue_date.slice(0, 10)} · {v.item_name ?? '(품목 미상)'} · {won(v.remaining)}
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
              <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border border-gray-200 rounded-lg">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
                  <p className="text-xs font-semibold text-gray-700">미연결 주문 ({filteredOrders.length})</p>
                  <input value={orderQuery} onChange={e => setOrderQuery(e.target.value)} placeholder="주문번호·금액 검색"
                    className="ml-auto border border-gray-200 rounded px-2 py-1 text-xs w-32" />
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {filteredOrders.map(o => (
                    <label key={o.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${selOrders.has(o.id) ? 'bg-slate-50' : 'hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={selOrders.has(o.id)} onChange={() => toggleId(selOrders, setSelOrders, o.id)} />
                      <span className="text-gray-500 whitespace-nowrap">{o.order_date.slice(0, 10)}</span>
                      <span className="text-gray-900 truncate">{o.order_no}</span>
                      <span className="ml-auto tabular-nums font-medium whitespace-nowrap">{won(o.remaining)}</span>
                    </label>
                  ))}
                  {filteredOrders.length === 0 && <p className="text-xs text-gray-400 text-center py-6">미연결 주문이 없습니다.</p>}
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
                  <p className="text-xs font-semibold text-indigo-800">미배분 계산서 ({filteredInvoices.length})</p>
                  <input value={invoiceQuery} onChange={e => setInvoiceQuery(e.target.value)} placeholder="품목·금액 검색"
                    className="ml-auto border border-gray-200 rounded px-2 py-1 text-xs w-32" />
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {filteredInvoices.map(v => (
                    <label key={v.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${selInvoices.has(v.id) ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={selInvoices.has(v.id)} onChange={() => toggleId(selInvoices, setSelInvoices, v.id)} />
                      <span className="text-gray-500 whitespace-nowrap">{v.issue_date.slice(0, 10)}</span>
                      <span className="text-gray-900 truncate">{v.item_name ?? '(품목 미상)'}</span>
                      <span className="ml-auto tabular-nums font-medium whitespace-nowrap">{won(v.remaining)}</span>
                    </label>
                  ))}
                  {filteredInvoices.length === 0 && <p className="text-xs text-gray-400 text-center py-6">미배분 계산서가 없습니다.</p>}
                </div>
              </div>
            </div>

            {manualPlan && (
              <div className={`mt-3 px-3 py-2.5 rounded-lg text-xs border ${manualPlan.valid ? 'bg-slate-50 border-slate-200 text-gray-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
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
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">선택 해제</button>
              <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
              <span className="text-xs text-gray-400">확정 후에도 모달이 열려 있어 이어서 연결할 수 있습니다.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
