'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// 주문 쪽 수금 매칭 모달 (2026-11-04) — ERP 주문내역·주문 현황에서 "수금 매칭" 버튼으로 연다.
// 이 주문의 거래처 미배분 결제(은행 입금·카드결제)를 고르고 금액을 붙인다. 한 결제를 여러 주문에
// 나누는 작업은 입금 매칭 화면(/erp-matching?depositId=)으로 잇는다.

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`
const toNum = (s: string) => Math.round(Number(String(s).replace(/[^\d.-]/g, ''))) || 0

interface OrderSummary {
  id: string; order_no: string | null; order_date: string; customer_name: string
  vendor_id: string | null; vendor_name: string | null; collect_status: string | null
  net_amount: number; allocated: number; remaining: number
  matches: { id: string; source_type: string; source_id: string; amount: number; paid_date: string; label: string }[]
}
interface Candidate {
  source_type: 'bank' | 'card'; id: string; tx_date: string; tx_time: string | null; label: string
  card_number: string | null; vendor_id: string | null; vendor_name: string | null
  amount: number; allocated: number; remaining: number
}

// hideAccountingLinks: 주문 화면(영업·주문)에서 열 때 회계 화면 링크를 숨긴다 — 주문 쪽 → 회계 이동 불가 원칙 (2026-11-04 사용자 결정)
export default function CollectMatchModal({ orderId, onClose, onSaved, hideAccountingLinks = false }: {
  orderId: string; onClose: () => void; onSaved?: () => void; hideAccountingLinks?: boolean
}) {
  const [order, setOrder] = useState<OrderSummary | null>(null)
  const [cands, setCands] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [scope, setScope] = useState<'vendor' | 'all'>('vendor')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [card4, setCard4] = useState('')
  const [q, setQ] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})   // `${type}:${id}` → 입력값
  const [registerCard, setRegisterCard] = useState(true)
  const [unmatching, setUnmatching] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ orderId, scope })
    if (from) p.set('from', from); if (to) p.set('to', to)
    if (amount) p.set('amount', amount); if (card4) p.set('card4', card4); if (q) p.set('q', q)
    const res = await fetch(`/api/erp-matching/order?${p}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setMsg(json.error ?? '조회 실패'); setLoading(false); return }
    setOrder(json.order); setCands(json.candidates ?? [])
    // 잔액이 정확히 일치하는 후보가 하나면 미리 채운다
    const o: OrderSummary = json.order
    const exact = (json.candidates as Candidate[]).filter(c => c.remaining === o.remaining)
    setAlloc(exact.length === 1 && o.remaining > 0 ? { [`${exact[0].source_type}:${exact[0].id}`]: String(o.remaining) } : {})
    setLoading(false)
  }, [orderId, scope, from, to, amount, card4, q])

  useEffect(() => { load() }, [load])

  const allocSum = useMemo(() => Object.values(alloc).reduce((s, v) => s + toNum(v), 0), [alloc])
  const selectedNoVendorCards = useMemo(
    () => cands.filter(c => c.source_type === 'card' && !c.vendor_id && toNum(alloc[`card:${c.id}`] ?? '') > 0),
    [cands, alloc],
  )
  const firstSelected = useMemo(() => cands.find(c => toNum(alloc[`${c.source_type}:${c.id}`] ?? '') > 0) ?? null, [cands, alloc])

  const setOne = (c: Candidate, v: string) => {
    const n = toNum(v)
    const cap = Math.min(c.remaining, (order?.remaining ?? 0))
    const val = n > cap ? String(cap) : v
    setAlloc(prev => ({ ...prev, [`${c.source_type}:${c.id}`]: val }))
  }

  const save = async () => {
    if (!order || saving) return
    const allocations = cands
      .map(c => ({ source_type: c.source_type, source_id: c.id, amount: toNum(alloc[`${c.source_type}:${c.id}`] ?? '') }))
      .filter(a => a.amount > 0)
    if (!allocations.length) { setMsg('배분할 결제에 금액을 입력하세요.'); return }
    if (allocSum > order.remaining) { setMsg(`배분 합계(${won(allocSum)})가 주문 미수(${won(order.remaining)})를 초과합니다.`); return }
    setSaving(true)
    const res = await fetch('/api/erp-matching/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.id, allocations, register_card: registerCard }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setMsg(json.error ?? '저장 실패'); return }
    setMsg(`매칭 ${json.inserted}건 저장${json.linked_vendor ? ` · 카드결제 거래처 연결 ${json.linked_vendor}` : ''}${json.registered_cards ? ` · 카드번호 등록 ${json.registered_cards}` : ''}`)
    onSaved?.()
    load()
  }

  const unmatch = async (m: OrderSummary['matches'][number]) => {
    if (!window.confirm(`매칭 ${won(m.amount)} (${m.paid_date}, ${m.label})을 해제할까요?`)) return
    setUnmatching(m.id)
    const res = await fetch(`/api/erp-matching?id=${m.id}`, { method: 'DELETE' })
    setUnmatching(null)
    if (!res.ok) { setMsg('해제 실패'); return }
    onSaved?.()
    load()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[900px] max-w-full max-h-[92vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">수금 매칭{order ? ` — 주문 ${order.order_no ?? ''}` : ''}</h3>
            {order && (
              <p className="text-xs text-gray-500 mt-0.5">
                {order.customer_name || order.vendor_name || '(거래처 없음)'} · {order.order_date} · 순매출 <b>{won(order.net_amount)}</b> · 기배분 {won(order.allocated)} ·
                <span className={`ml-1 font-medium ${order.remaining > 0 ? 'text-red-600' : 'text-emerald-700'}`}>미수 {won(order.remaining)}</span>
                {!order.vendor_id && <span className="ml-2 text-amber-600">거래처 미연결 주문 — 전체에서 찾기만 가능</span>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        </div>

        {msg && <div className="mt-3 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg">{msg}</div>}

        {/* 기매칭 */}
        {order && order.matches.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="text-gray-500 mb-1">이미 매칭된 결제 {order.matches.length}건</div>
            <div className="flex flex-wrap gap-1.5">
              {order.matches.map(m => (
                <span key={m.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-gray-50">
                  <span className={`px-1 rounded ${m.source_type === 'card' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>{m.source_type === 'card' ? '카드' : '계좌'}</span>
                  {m.paid_date} · {won(m.amount)} <span className="text-gray-400">{m.label}</span>
                  <button onClick={() => unmatch(m)} disabled={unmatching === m.id} className="text-red-500 hover:underline ml-1">해제</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 후보 범위·검색 */}
        <div className="flex flex-wrap items-center gap-2 mt-4 text-xs">
          <span className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            <button onClick={() => setScope('vendor')} disabled={!order?.vendor_id}
              className={`px-2.5 py-1.5 font-medium ${scope === 'vendor' ? 'bg-slate-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} disabled:opacity-40`}>이 거래처 결제</button>
            <button onClick={() => setScope('all')}
              className={`px-2.5 py-1.5 font-medium ${scope === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>전체에서 찾기</button>
          </span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1" />
          <span className="text-gray-400">~</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1" />
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="금액" className="border border-gray-300 rounded px-2 py-1 w-24" />
          <input value={card4} onChange={e => setCard4(e.target.value)} placeholder="카드 끝4자리" className="border border-gray-300 rounded px-2 py-1 w-24" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="입금자·적요·매입사" className="border border-gray-300 rounded px-2 py-1 w-36" disabled={scope !== 'all'} />
          <span className="text-gray-400">{scope === 'all' ? '거래처 없는 카드결제·다른 거래처 입금까지 (기본 기간: 주문일 30일 전 ~ 오늘)' : '이 거래처로 들어온 미배분 결제'}</span>
        </div>

        {/* 후보 목록 */}
        <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-400">
              <tr>
                <th className="py-1.5 px-2 text-left">원천</th><th className="py-1.5 px-2 text-left">일자</th>
                <th className="py-1.5 px-2 text-left">입금자 / 카드번호 · 매입사</th><th className="py-1.5 px-2 text-left">거래처</th>
                <th className="py-1.5 px-2 text-right">결제액</th><th className="py-1.5 px-2 text-right">미배분</th><th className="py-1.5 px-2 text-right w-36">이 주문에 배분</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="py-6 text-center text-gray-400">불러오는 중...</td></tr>
              ) : cands.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-gray-400">미배분 결제가 없습니다. {scope === 'vendor' ? '전체에서 찾기로 넓혀 보세요.' : '기간·조건을 바꿔 보세요.'}</td></tr>
              ) : cands.map(c => {
                const key = `${c.source_type}:${c.id}`
                const v = alloc[key] ?? ''
                const on = toNum(v) > 0
                return (
                  <tr key={key} className={on ? 'bg-sky-50' : 'hover:bg-gray-50'}>
                    <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded ${c.source_type === 'card' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>{c.source_type === 'card' ? '카드' : '계좌'}</span></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{c.tx_date}{c.tx_time ? ` ${c.tx_time.slice(0, 5)}` : ''}</td>
                    <td className="px-2 py-1.5">{c.label || '-'}</td>
                    <td className="px-2 py-1.5">{c.vendor_name ?? <span className="text-amber-600">(거래처 없음)</span>}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{won(c.amount)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{won(c.remaining)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <input value={v} onChange={e => setOne(c, e.target.value)} placeholder="0"
                        onFocus={() => { if (!v && order) setOne(c, String(Math.min(c.remaining, order.remaining))) }}
                        className={`border rounded px-2 py-1 w-32 text-right ${on ? 'border-sky-400' : 'border-gray-300'}`} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {selectedNoVendorCards.length > 0 && order?.vendor_id && (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            선택한 카드결제 {selectedNoVendorCards.length}건에 거래처가 없습니다. 저장하면 이 주문의 거래처({order.vendor_name})로 연결합니다.
            <label className="inline-flex items-center gap-1 ml-2">
              <input type="checkbox" checked={registerCard} onChange={e => setRegisterCard(e.target.checked)} /> 카드번호를 이 거래처에 등록 (다음부터 자동 연결)
            </label>
          </div>
        )}

        <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
          <div className="text-xs text-gray-500">
            배분 합계 <b className="text-gray-900">{won(allocSum)}</b> / 미수 {won(order?.remaining)}
            {order && <> → 저장 후 미수 <b className={order.remaining - allocSum <= 0 ? 'text-emerald-700' : 'text-red-600'}>{won(Math.max(0, order.remaining - allocSum))}</b></>}
            {firstSelected && firstSelected.remaining - toNum(alloc[`${firstSelected.source_type}:${firstSelected.id}`] ?? '') > 0 && (
              <span className="ml-2 text-gray-400">결제 미배분 잔액 {won(firstSelected.remaining - toNum(alloc[`${firstSelected.source_type}:${firstSelected.id}`] ?? ''))} 남음</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {firstSelected && !hideAccountingLinks && (
              <Link href={`/erp-matching?depositId=${firstSelected.source_type}:${firstSelected.id}`} className="text-xs text-sky-700 hover:underline"
                title="저장 후 이 결제의 남은 잔액을 다른 주문에 나눕니다">
                이 결제건을 다른 주문에도 배분 →
              </Link>
            )}
            <button onClick={onClose} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">닫기</button>
            <button onClick={save} disabled={saving || !order || allocSum <= 0}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? '저장 중...' : `저장 (${won(allocSum)})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
