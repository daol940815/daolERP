'use client'

import { useState } from 'react'

// 결제 기록 (1300, 2026-11-13 사용자 확정 — 시안 docs/mockups/결제처리_시안.html)
// 1차 수기 입력: 카드결제 / 계좌이체 / 계산서 발행. 기록만으로는 미수가 줄지 않는다('확인 대기').
// 2차 결제 확인(수금 · 정산 작업 › 결제 확인)에서 원본과 대조해 확정하면 미수가 줄고 기록은 잠긴다.
// 이 화면에서 통장 · 카드 원본 화면으로 가는 링크는 두지 않는다(주문 화면 → 회계 이동 불가 원칙).

export type PayMethod = 'card' | 'transfer' | 'invoice'
export interface PayRecord {
  id: string; method: PayMethod; pay_date: string; amount: number
  approval_number: string | null; card_last4: string | null; depositor_name: string | null; due_date: string | null
  memo: string | null; created_by_name: string | null; created_at: string
  confirmed_by_name: string | null; confirmed_at: string | null
  orders: { order_id: string; order_no: string | null; amount: number }[]
}
export interface PayRecordsData { available: boolean; records: PayRecord[]; can_record: boolean }
interface Cand { order_id: string; order_no: string | null; order_date: string; customer_name: string; unpaid: number }

const METHODS: { key: PayMethod; label: string }[] = [
  { key: 'card', label: '카드결제' }, { key: 'transfer', label: '계좌이체' }, { key: 'invoice', label: '계산서 발행' },
]
const BADGE: Record<PayMethod, string> = {
  card: 'bg-violet-50 text-violet-700', transfer: 'bg-blue-50 text-blue-700', invoice: 'bg-indigo-50 text-indigo-700',
}
const SHORT: Record<PayMethod, string> = { card: '카드', transfer: '계좌이체', invoice: '계산서 발행' }
const won = (n: number) => n.toLocaleString('ko-KR')
const num = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
const stamp = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000).toISOString()
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`
}

export function clueOf(r: Pick<PayRecord, 'method' | 'approval_number' | 'card_last4' | 'depositor_name' | 'due_date'>) {
  if (r.method === 'card') return [r.approval_number && `승인 ${r.approval_number}`, r.card_last4 && `카드 뒤 ${r.card_last4}`].filter(Boolean).join(' · ')
  if (r.method === 'transfer') return r.depositor_name ? `입금자 ${r.depositor_name}` : '입금자 미기재'
  return r.due_date ? `입금 예정 ${r.due_date}` : '입금 예정일 미기재'
}

export default function PayRecords({ orderId, data, outstanding, onChanged }: {
  orderId: string; data: PayRecordsData; outstanding: number; onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [method, setMethod] = useState<PayMethod>('card')
  const [payDate, setPayDate] = useState(today())
  const [approval, setApproval] = useState('')
  const [last4, setLast4] = useState('')
  const [depositor, setDepositor] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [memo, setMemo] = useState('')
  const [cands, setCands] = useState<Cand[]>([])
  const [alloc, setAlloc] = useState<Record<string, string>>({})   // 주문별 금액 (선택된 주문만 키가 있다)
  const [showOthers, setShowOthers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pendingHere = data.records.filter(r => !r.confirmed_at)
    .reduce((s, r) => s + (r.orders.find(o => o.order_id === orderId)?.amount ?? 0), 0)
  const unpaidHere = Math.max(0, outstanding - pendingHere)

  const openForm = async (rec?: PayRecord) => {
    setErr(null); setEditId(rec?.id ?? null)
    setMethod(rec?.method ?? 'card'); setPayDate(rec?.pay_date ?? today())
    setApproval(rec?.approval_number ?? ''); setLast4(rec?.card_last4 ?? '')
    setDepositor(rec?.depositor_name ?? ''); setDueDate(rec?.due_date ?? ''); setMemo(rec?.memo ?? '')
    setOpen(true)
    const res = await fetch(`/api/orders-portal/orders/${orderId}/pay-records${rec ? `?exclude=${rec.id}` : ''}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error ?? '주문 목록을 불러오지 못했습니다.'); setCands([]); return }
    const list = (json.orders ?? []) as Cand[]
    setCands(list)
    if (rec) {
      setAlloc(Object.fromEntries(rec.orders.map(o => [o.order_id, String(o.amount)])))
      setShowOthers(rec.orders.length > 1)
    } else {
      const me = list.find(c => c.order_id === orderId)
      setAlloc({ [orderId]: String(me?.unpaid ?? 0) }); setShowOthers(false)
    }
  }

  const total = Object.values(alloc).reduce((s, v) => s + num(v), 0)
  const picked = cands.filter(c => c.order_id in alloc)
  const others = cands.filter(c => !(c.order_id in alloc))

  const submit = async () => {
    setBusy(true); setErr(null)
    const body = {
      method, pay_date: payDate, amount: total,
      approval_number: approval, card_last4: last4, depositor_name: depositor, due_date: dueDate || null, memo,
      allocations: Object.entries(alloc).map(([order_id, v]) => ({ order_id, amount: num(v) })).filter(a => a.amount > 0),
    }
    const res = await fetch(`/api/orders-portal/orders/${orderId}/pay-records${editId ? `?record_id=${editId}` : ''}`, {
      method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(json.error ?? '저장 실패'); return }
    setOpen(false); onChanged()
  }

  const remove = async (r: PayRecord) => {
    if (!confirm(`${SHORT[r.method]} ${won(r.amount)}원 결제 기록을 삭제할까요?${r.orders.length > 1 ? `\n주문 ${r.orders.length}건에 걸친 기록이며 모두에서 지워집니다.` : ''}`)) return
    const res = await fetch(`/api/orders-portal/orders/${orderId}/pay-records?record_id=${r.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { alert(json.error ?? '삭제 실패'); return }
    onChanged()
  }

  if (!data.available) return null   // 1300 미적용 — 기존 화면 그대로

  const inputCls = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'
  const labelCls = 'block text-[0.6875rem] text-gray-500 mb-1'

  return (
    <div className="mb-3 pb-3 border-b border-gray-100">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-xs font-semibold text-gray-700">결제 기록</span>
        <span className="text-[0.6875rem] text-gray-400">결제한 내용을 적어 두면 회계에서 실제 입금 · 카드 매출과 매칭합니다</span>
        {pendingHere > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
            매칭 대기 <b className="tabular-nums">{won(pendingHere)}원</b>
          </span>
        )}
        {data.can_record && !open && (
          <button onClick={() => openForm()} disabled={unpaidHere <= 0}
            title={unpaidHere <= 0 ? '미결제 금액이 없습니다 (수금 완료이거나 이미 전액 기록됨)' : undefined}
            className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-40">
            결제 기록 추가
          </button>
        )}
      </div>

      {open && (
        <div className="mb-3 p-3 rounded-xl border border-slate-300 bg-slate-50">
          <div className="flex gap-1 flex-wrap mb-3">
            {METHODS.map(m => (
              <button key={m.key} type="button" onClick={() => setMethod(m.key)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${method === m.key ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-2.5">
            <div>
              <label className={labelCls}>{method === 'invoice' ? '발행일' : '결제일'}</label>
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inputCls} />
            </div>
            {method === 'card' && (<>
              <div>
                <label className={labelCls}>승인번호</label>
                <input value={approval} onChange={e => setApproval(e.target.value.trim())} placeholder="카드 전표의 승인번호" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>카드 뒤 4자리</label>
                <input value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="0000" className={inputCls} />
              </div>
            </>)}
            {method === 'transfer' && (
              <div className="col-span-2">
                <label className={labelCls}>입금자명</label>
                <input value={depositor} onChange={e => setDepositor(e.target.value)} placeholder="통장에 찍히는 이름 (모르면 비워 두기)" className={inputCls} />
              </div>
            )}
            {method === 'invoice' && (
              <div>
                <label className={labelCls}>입금 예정일 (선택)</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
          <div className="mb-2.5">
            <label className={labelCls}>메모</label>
            <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 2차분. 잔액은 다음 주 이체 예정" className={inputCls} />
          </div>

          <label className={labelCls}>주문별 금액 — 합계가 결제 금액이 됩니다</label>
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {picked.map(c => (
              <div key={c.order_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm flex-wrap">
                <b className="tabular-nums">{c.order_no ?? '-'}</b>
                {c.order_id !== orderId && <span className="text-xs text-gray-500 truncate max-w-[12rem]">{c.customer_name}</span>}
                <span className="text-[0.6875rem] text-gray-400">미결제 {won(c.unpaid)}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <input value={alloc[c.order_id] ? won(num(alloc[c.order_id])) : ''} inputMode="numeric"
                    onChange={e => setAlloc(a => ({ ...a, [c.order_id]: e.target.value.replace(/[^\d]/g, '') }))}
                    className="w-28 border border-amber-300 bg-amber-50 rounded-lg px-2 py-1 text-sm text-right font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  <button type="button" onClick={() => setAlloc(a => ({ ...a, [c.order_id]: String(c.unpaid) }))}
                    className="text-[0.6875rem] px-1.5 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">전액</button>
                  {c.order_id !== orderId && (
                    <button type="button" onClick={() => setAlloc(a => { const n = { ...a }; delete n[c.order_id]; return n })}
                      className="text-[0.6875rem] px-1.5 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">빼기</button>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {others.length > 0 && (
              <button type="button" onClick={() => setShowOthers(v => !v)}
                className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white text-gray-600 hover:bg-gray-50">
                {showOthers ? '다른 주문 접기' : `같은 매출처의 다른 주문 추가 (${others.length}건)`}
              </button>
            )}
            <span className="ml-auto text-sm text-gray-700">결제 금액 <b className="tabular-nums">{won(total)}원</b>
              {picked.length > 1 && <span className="text-xs text-gray-400"> · 주문 {picked.length}건</span>}</span>
          </div>
          {showOthers && others.length > 0 && (
            <div className="mt-2 rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {others.map(c => (
                <button key={c.order_id} type="button" onClick={() => setAlloc(a => ({ ...a, [c.order_id]: String(c.unpaid) }))}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left hover:bg-gray-50">
                  <b className="tabular-nums">{c.order_no ?? '-'}</b>
                  <span className="text-xs text-gray-400 tabular-nums">{c.order_date}</span>
                  <span className="text-xs text-gray-500 truncate">{c.customer_name}</span>
                  <span className="ml-auto text-xs text-gray-600 tabular-nums">미결제 {won(c.unpaid)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 text-[0.6875rem] text-gray-400">
            카드번호 전체 · 유효기간은 적지 않습니다(승인번호와 뒤 4자리로 대조). 기록만으로는 미수가 줄지 않고, 매칭된 뒤에 줄어듭니다.
          </div>
          {err && <div className="mt-1.5 text-xs text-red-600">{err}</div>}
          <div className="flex justify-end gap-2 mt-2.5">
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">취소</button>
            <button onClick={submit} disabled={busy || total <= 0}
              className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-40">
              {busy ? '저장 중...' : editId ? '기록 수정' : '기록 저장'}
            </button>
          </div>
        </div>
      )}

      {data.records.length === 0 ? (
        !open && <div className="text-xs text-gray-400 py-1">결제 기록이 아직 없습니다.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[40rem]">
            <thead>
              <tr className="text-left text-[0.6875rem] text-gray-500 border-b border-gray-200">
                <th className="py-1.5 pr-2 font-normal">결제일</th>
                <th className="py-1.5 pr-2 font-normal">수단</th>
                <th className="py-1.5 pr-2 font-normal">대조 단서</th>
                <th className="py-1.5 pr-2 font-normal text-right">이 주문 금액</th>
                <th className="py-1.5 pr-2 font-normal">기록</th>
                <th className="py-1.5 pr-2 font-normal">상태</th>
                <th className="py-1.5 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {data.records.map(r => {
                const mine = r.orders.find(o => o.order_id === orderId)?.amount ?? 0
                const otherNos = r.orders.filter(o => o.order_id !== orderId).map(o => o.order_no).filter(Boolean)
                return (
                  <tr key={r.id} className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">{r.pay_date}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${BADGE[r.method]}`}>{SHORT[r.method]}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-xs text-gray-700">
                      {clueOf(r)}
                      {r.memo && <div className="text-[0.6875rem] text-gray-400">{r.memo}</div>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">
                      <b>{won(mine)}</b>
                      {otherNos.length > 0 && (
                        <div className="text-[0.6875rem] text-gray-400" title={otherNos.join(', ')}>결제 {won(r.amount)}원 · 다른 주문 {otherNos.length}건 포함</div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-xs text-gray-700 whitespace-nowrap">
                      {r.created_by_name ?? '-'}
                      <div className="text-[0.6875rem] text-gray-400 tabular-nums">{stamp(r.created_at)}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-xs whitespace-nowrap">
                      {r.confirmed_at ? (<>
                        <span className="inline-block px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold bg-green-100 text-green-800">매칭 완료</span>
                        <div className="text-[0.6875rem] text-gray-400 tabular-nums">{r.confirmed_by_name ?? ''} {stamp(r.confirmed_at)}</div>
                      </>) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold bg-amber-100 text-amber-800">매칭 대기</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {r.confirmed_at ? <span className="text-[0.6875rem] text-gray-400">잠김</span>
                        : data.can_record && (<>
                          <button onClick={() => openForm(r)} className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 mr-1">수정</button>
                          <button onClick={() => remove(r)} className="text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">삭제</button>
                        </>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
