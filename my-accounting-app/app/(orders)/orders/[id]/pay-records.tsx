'use client'

import { Fragment, useState } from 'react'
import ReasonPicker, { reasonReady, type ReasonValue } from '@/components/payments/ReasonPicker'
import { CARD_ENTRIES, CARD_ENTRY_LABEL, REC_VATS, REC_VAT_LABEL, kindLabel, type CardEntry, type RecVat } from '@/lib/payment-kind'

import { btnCls, fieldBox, labelCls } from '@/components/ui/kit'
// 결제 기록 (1300, 2026-11-13 사용자 확정 — 시안 docs/mockups/결제처리_시안.html)
// 1차 수기 입력: 카드결제 / 계좌이체 / 계산서 발행. 기록만으로는 미수가 줄지 않는다('확인 대기').
// 2차 결제 확인(수금 · 정산 작업 › 결제 확인)에서 원본과 대조해 확정하면 미수가 줄고 기록은 잠긴다.
// 방식 · 과세 구분(1304, 2026-11-18): 카드 = 단말기 · 수기 + 과세 · 면세, 계산서 발행 = 과세 · 면세, 계좌이체 = 없음.
//   새 기록은 필수, 이전 기록은 '미기재'(수정 때 채울 수 있으나 강제하지 않음). 매칭된 미기재 기록은 원본에서 읽은 값을 옆에 보여 준다.
// 취소(1305, 2026-11-18): 실제로 실행한 결제를 되돌린 것 — 삭제와 다르다. 원 기록 아래에 취소 줄로 남기고(부분 취소 가능), 회계가 원본과 매칭한다.
//   취소 · 삭제는 사유 필수, 수정은 금액 · 수단 · 승인번호 · 주문 배분 · 구분을 바꿀 때 필수. 사유는 상태에 마우스를 올리면 보인다.
// 이 화면에서 통장 · 카드 원본 화면으로 가는 링크는 두지 않는다(주문 화면 → 회계 이동 불가 원칙).

export type PayMethod = 'card' | 'transfer' | 'invoice'
export interface PayRecord {
  id: string; method: PayMethod; pay_date: string; amount: number
  approval_number: string | null; card_last4: string | null; depositor_name: string | null; due_date: string | null
  memo: string | null; created_by_name: string | null; created_at: string
  confirmed_by_name: string | null; confirmed_at: string | null
  card_entry?: CardEntry | null; vat_kind?: RecVat | null; source_kind?: string | null
  cancels?: CancelLine[]; canceled?: number; reason_text?: string | null
  last_release?: { text: string; by: string | null; at: string } | null
  orders: { order_id: string; order_no: string | null; amount: number }[]
}
export interface CancelLine {
  id: string; amount: number; pay_date: string; reason_text: string | null
  created_by_name: string | null; created_at: string; confirmed_by_name: string | null; confirmed_at: string | null
  orders: { order_id: string; amount: number }[]
}
export interface PayRecordsData { available: boolean; kinds?: boolean; cancelable?: boolean; records: PayRecord[]; can_record: boolean }
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
  const [entry, setEntry] = useState<CardEntry | null>(null)
  const [vat, setVat] = useState<RecVat | null>(null)
  const [depositor, setDepositor] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [memo, setMemo] = useState('')
  const [cands, setCands] = useState<Cand[]>([])
  const [alloc, setAlloc] = useState<Record<string, string>>({})   // 주문별 금액 (선택된 주문만 키가 있다)
  const [showOthers, setShowOthers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reason, setReason] = useState<ReasonValue | null>(null)   // 수정 사유 (주요 항목을 바꿀 때만)
  // 취소 · 삭제 창 (기록 한 건에 대해 하나만 연다)
  const [act, setAct] = useState<{ type: 'cancel' | 'delete'; rec: PayRecord; lineId?: string } | null>(null)
  const [actReason, setActReason] = useState<ReasonValue | null>(null)
  const [cancelDate, setCancelDate] = useState(today())
  const [cancelFull, setCancelFull] = useState(true)
  const [cancelAlloc, setCancelAlloc] = useState<Record<string, string>>({})
  const [actBusy, setActBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)

  // 이 주문 몫: 기록 금액 − 취소 줄 금액
  const canceledOf = (r: PayRecord, oid: string) => (r.cancels ?? []).reduce((s, c) => s + (c.orders.find(o => o.order_id === oid)?.amount ?? 0), 0)
  const pendingHere = data.records.filter(r => !r.confirmed_at)
    .reduce((s, r) => s + Math.max(0, (r.orders.find(o => o.order_id === orderId)?.amount ?? 0) - canceledOf(r, orderId)), 0)
  const unpaidHere = Math.max(0, outstanding - pendingHere)

  const openForm = async (rec?: PayRecord) => {
    setErr(null); setEditId(rec?.id ?? null); setReason(null); setAct(null)
    setMethod(rec?.method ?? 'card'); setPayDate(rec?.pay_date ?? today())
    setApproval(rec?.approval_number ?? ''); setLast4(rec?.card_last4 ?? '')
    setEntry(rec?.card_entry ?? null); setVat(rec?.vat_kind ?? null)
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

  // 수정 사유가 필요한 변경인가 — 금액 · 수단 · 승인번호 · 주문 배분 · 구분 (메모 · 날짜 · 입금자만 고치면 받지 않는다)
  const editing = editId ? data.records.find(r => r.id === editId) ?? null : null
  const majorChanged = !!editing && !!data.cancelable && (
    editing.method !== method || editing.amount !== total
    || (editing.approval_number ?? '') !== (method === 'card' ? approval : '')
    || (editing.card_entry ?? null) !== (method === 'card' ? entry : null)
    || (editing.vat_kind ?? null) !== (method === 'transfer' ? null : vat)
    || editing.orders.length !== Object.values(alloc).filter(v => num(v) > 0).length
    || editing.orders.some(o => num(alloc[o.order_id] ?? '') !== o.amount))

  const openAct = (type: 'cancel' | 'delete', rec: PayRecord, lineId?: string) => {
    setOpen(false); setAct({ type, rec, lineId }); setActReason(null); setActErr(null)
    setCancelDate(today()); setCancelFull(true)
    setCancelAlloc(Object.fromEntries(rec.orders.map(o => [o.order_id, String(Math.max(0, o.amount - canceledOf(rec, o.order_id)))])))
  }
  const submitAct = async () => {
    if (!act) return
    setActBusy(true); setActErr(null)
    const base = `/api/orders-portal/orders/${orderId}/pay-records`
    const res = act.type === 'cancel'
      ? await fetch(`${base}?cancel_of=${act.rec.id}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cancel_date: cancelDate, full: cancelFull, reason: actReason,
            allocations: Object.entries(cancelAlloc).map(([order_id, v]) => ({ order_id, amount: num(v) })).filter(a => a.amount > 0),
          }),
        })
      : await fetch(`${base}?record_id=${act.lineId ?? act.rec.id}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: actReason }),
        })
    const json = await res.json().catch(() => ({}))
    setActBusy(false)
    if (!res.ok) { setActErr(json.error ?? '처리 실패'); return }
    setAct(null); onChanged()
  }

  const submit = async () => {
    setBusy(true); setErr(null)
    const body = {
      ...(majorChanged ? { reason } : {}),
      method, pay_date: payDate, amount: total,
      card_entry: method === 'card' ? entry : null, vat_kind: method === 'transfer' ? null : vat,
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
    if (data.cancelable) { openAct('delete', r); return }   // 1305 적용 뒤에는 사유를 받는다
    if (!confirm(`${SHORT[r.method]} ${won(r.amount)}원 결제 기록을 삭제할까요?${r.orders.length > 1 ? `\n주문 ${r.orders.length}건에 걸친 기록이며 모두에서 지워집니다.` : ''}`)) return
    const res = await fetch(`/api/orders-portal/orders/${orderId}/pay-records?record_id=${r.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { alert(json.error ?? '삭제 실패'); return }
    onChanged()
  }

  if (!data.available) return null   // 1300 미적용 — 기존 화면 그대로

  const kinds = !!data.kinds
  // 새 기록은 구분 필수. 이전 기록(미기재) 수정은 비워 둬도 저장된다.
  const kindNeeded = kinds && !editId && (method === 'card' ? !entry || !vat : method === 'invoice' ? !vat : false)
  const pick = <T extends string>(cur: T | null, list: T[], label: Record<T, string>, set: (v: T) => void) => (
    <div className="flex gap-1">
      {list.map(v => (
        <button key={v} type="button" onClick={() => set(v)}
          className={`px-3 py-1.5 rounded-lg text-xs border ${cur === v ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-50'}`}>
          {label[v]}
        </button>
      ))}
    </div>
  )

  const inputCls = fieldBox()

  return (
    <div className="mb-3 pb-3 border-b border-slate-200">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-xs font-semibold text-slate-800">결제 기록</span>
        <span className="text-xs text-slate-500">결제한 내용을 적어 두면 회계에서 실제 입금 · 카드 매출과 매칭합니다</span>
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
        <div className="mb-3 p-3 rounded-xl border border-slate-400 bg-slate-50">
          <div className="flex gap-1 flex-wrap mb-3">
            {METHODS.map(m => (
              <button key={m.key} type="button" onClick={() => setMethod(m.key)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${method === m.key ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-50'}`}>
                {m.label}
              </button>
            ))}
          </div>
          {kinds && method !== 'transfer' && (
            <div className="mb-3 p-2.5 rounded-lg border border-slate-300 bg-white">
              <div className="flex gap-x-6 gap-y-2 flex-wrap">
                {method === 'card' && (
                  <div>
                    <label className={labelCls}>카드 결제 방식{!editId && <span className="text-red-600"> *</span>}</label>
                    {pick(entry, CARD_ENTRIES, CARD_ENTRY_LABEL, setEntry)}
                  </div>
                )}
                <div>
                  <label className={labelCls}>과세 구분{!editId && <span className="text-red-600"> *</span>}</label>
                  {pick(vat, REC_VATS, REC_VAT_LABEL, setVat)}
                </div>
              </div>
              <div className="mt-1.5 text-xs text-slate-500">
                {method === 'card'
                  ? '단말기 = 카드 단말기로 결제 · 수기 = 카드번호를 받아 결제 창구에서 입력. 과세와 면세 품목이 섞여 결제가 둘로 나뉘었으면 기록도 두 건으로 남깁니다.'
                  : '과세 = 세금계산서 · 면세 = 계산서. 둘 다 발행했으면 기록도 두 건으로 남깁니다.'}
                {' '}실제 결제(발행)와 구분이 다르면 매칭되지 않습니다.
              </div>
            </div>
          )}
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
          <div className="rounded-lg border border-slate-300 bg-white divide-y divide-slate-200">
            {picked.map(c => (
              <div key={c.order_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm flex-wrap">
                <b className="tabular-nums">{c.order_no ?? '-'}</b>
                {c.order_id !== orderId && <span className="text-xs text-slate-600 truncate max-w-[12rem]">{c.customer_name}</span>}
                <span className="text-xs text-slate-500">미결제 {won(c.unpaid)}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <input value={alloc[c.order_id] ? won(num(alloc[c.order_id])) : ''} inputMode="numeric"
                    onChange={e => setAlloc(a => ({ ...a, [c.order_id]: e.target.value.replace(/[^\d]/g, '') }))}
                    className="w-28 border border-amber-300 bg-amber-50 rounded-lg px-2 py-1 text-sm text-right font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  <button type="button" onClick={() => setAlloc(a => ({ ...a, [c.order_id]: String(c.unpaid) }))}
                    className={btnCls('secondary', 'sm')}>전액</button>
                  {c.order_id !== orderId && (
                    <button type="button" onClick={() => setAlloc(a => { const n = { ...a }; delete n[c.order_id]; return n })}
                      className={btnCls('secondary', 'sm')}>빼기</button>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {others.length > 0 && (
              <button type="button" onClick={() => setShowOthers(v => !v)}
                className={btnCls('secondary', 'sm')}>
                {showOthers ? '다른 주문 접기' : `같은 매출처의 다른 주문 추가 (${others.length}건)`}
              </button>
            )}
            <span className="ml-auto text-sm text-slate-800">결제 금액 <b className="tabular-nums">{won(total)}원</b>
              {picked.length > 1 && <span className="text-xs text-slate-500"> · 주문 {picked.length}건</span>}</span>
          </div>
          {showOthers && others.length > 0 && (
            <div className="mt-2 rounded-lg border border-slate-300 bg-white divide-y divide-slate-200 max-h-48 overflow-y-auto">
              {others.map(c => (
                <button key={c.order_id} type="button" onClick={() => setAlloc(a => ({ ...a, [c.order_id]: String(c.unpaid) }))}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left hover:bg-slate-50">
                  <b className="tabular-nums">{c.order_no ?? '-'}</b>
                  <span className="text-xs text-slate-500 tabular-nums">{c.order_date}</span>
                  <span className="text-xs text-slate-600 truncate">{c.customer_name}</span>
                  <span className="ml-auto text-xs text-slate-700 tabular-nums">미결제 {won(c.unpaid)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            카드번호 전체 · 유효기간은 적지 않습니다(승인번호와 뒤 4자리로 대조). 기록만으로는 미수가 줄지 않고, 매칭된 뒤에 줄어듭니다.
          </div>
          {majorChanged && (
            <div className="mt-2.5 p-2.5 rounded-lg border border-amber-200 bg-amber-50">
              <ReasonPicker kind="update" value={reason} onChange={setReason} label="수정 사유 — 금액 · 수단 · 승인번호 · 주문 배분 · 구분을 바꿀 때 필요합니다" />
            </div>
          )}
          {err && <div className="mt-1.5 text-xs text-red-600">{err}</div>}
          <div className="flex justify-end gap-2 mt-2.5">
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 border border-slate-400 rounded-lg text-sm bg-white">취소</button>
            <button onClick={submit} disabled={busy || total <= 0 || kindNeeded || (majorChanged && !reasonReady(reason))}
              title={kindNeeded ? (method === 'card' ? '카드 결제 방식과 과세 구분을 고르세요' : '과세 구분을 고르세요') : undefined}
              className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-40">
              {busy ? '저장 중...' : editId ? '기록 수정' : '기록 저장'}
            </button>
          </div>
        </div>
      )}

      {act && (() => {
        const line = act.lineId ? act.rec.cancels?.find(c => c.id === act.lineId) : null
        const cancelTotal = cancelFull
          ? act.rec.orders.reduce((s, o) => s + Math.max(0, o.amount - canceledOf(act.rec, o.order_id)), 0)
          : Object.values(cancelAlloc).reduce((s, v) => s + num(v), 0)
        return (
          <div className="mb-3 p-3 rounded-xl border border-orange-300 bg-orange-50">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <b className="text-sm text-slate-900">{act.type === 'cancel' ? '결제 취소 기록' : line ? '취소 줄 삭제' : '결제 기록 삭제'}</b>
              <span className="text-xs text-slate-700">{SHORT[act.rec.method]} {act.rec.pay_date} · {clueOf(act.rec)} · {won(line ? line.amount : act.rec.amount)}원</span>
            </div>
            {act.type === 'cancel' ? (<>
              <div className="flex items-end gap-3 flex-wrap mb-2.5">
                <div>
                  <label className={labelCls}>취소일 <span className="text-red-600">*</span></label>
                  <input type="date" value={cancelDate} onChange={e => setCancelDate(e.target.value)} className={`${inputCls} w-40`} />
                </div>
                <div className="flex gap-1">
                  {([[true, '전액 취소'], [false, '부분 취소']] as const).map(([v, label]) => (
                    <button key={label} type="button" onClick={() => setCancelFull(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs border ${cancelFull === v ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-50'}`}>{label}</button>
                  ))}
                </div>
                <span className="text-sm text-slate-800">취소 금액 <b className="tabular-nums text-red-700">−{won(cancelTotal)}원</b></span>
              </div>
              {!cancelFull && (
                <div className="mb-2.5 rounded-lg border border-slate-300 bg-white divide-y divide-slate-200">
                  {act.rec.orders.map(o => {
                    const left = Math.max(0, o.amount - canceledOf(act.rec, o.order_id))
                    return (
                      <div key={o.order_id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm flex-wrap">
                        <b className="tabular-nums">{o.order_no ?? '-'}</b>
                        <span className="text-xs text-slate-500">취소 가능 {won(left)}</span>
                        <input value={cancelAlloc[o.order_id] ? won(num(cancelAlloc[o.order_id])) : ''} inputMode="numeric"
                          onChange={e => setCancelAlloc(a => ({ ...a, [o.order_id]: e.target.value.replace(/[^\d]/g, '') }))}
                          className="ml-auto w-28 border border-amber-300 bg-amber-50 rounded-lg px-2 py-1 text-sm text-right font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900" />
                      </div>
                    )
                  })}
                </div>
              )}
              <ReasonPicker kind="cancel" value={actReason} onChange={setActReason} label="취소 사유" />
              <div className="mt-2 text-xs text-slate-600">
                실제로 {act.rec.method === 'card' ? '카드 승인을 취소' : act.rec.method === 'invoice' ? '취소 계산서를 발행' : '돈을 돌려준'}한 경우에만 남깁니다. 기록을 잘못 적은 것이면 &quot;삭제&quot;를 쓰세요.
                취소만으로는 미수가 바뀌지 않고, 회계가 {act.rec.method === 'card' ? '카드 매출의 취소 내역' : act.rec.method === 'invoice' ? '홈택스 취소 계산서' : '통장 출금'}과 매칭하면 바뀝니다.
              </div>
            </>) : (<>
              <ReasonPicker kind="delete" value={actReason} onChange={setActReason} label="삭제 사유" />
              <div className="mt-2 text-xs text-slate-600">
                {line ? '잘못 남긴 취소 줄을 없앱니다.' : '잘못 적은 기록을 없앱니다. 실제로 결제했다가 되돌린 것이면 삭제가 아니라 "취소"를 쓰세요.'}
                {!line && act.rec.orders.length > 1 && ` 주문 ${act.rec.orders.length}건에 걸친 기록이며 모두에서 지워집니다.`}
              </div>
            </>)}
            {actErr && <div className="mt-1.5 text-xs text-red-600">{actErr}</div>}
            <div className="flex justify-end gap-2 mt-2.5">
              <button onClick={() => setAct(null)} className="px-3 py-1.5 border border-slate-400 rounded-lg text-sm bg-white">닫기</button>
              <button onClick={submitAct} disabled={actBusy || !reasonReady(actReason) || (act.type === 'cancel' && cancelTotal <= 0)}
                className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white font-semibold hover:bg-slate-700 disabled:opacity-40">
                {actBusy ? '처리 중...' : act.type === 'cancel' ? '취소 기록 저장' : '삭제'}
              </button>
            </div>
          </div>
        )
      })()}

      {data.records.length === 0 ? (
        !open && <div className="text-xs text-slate-500 py-1">결제 기록이 아직 없습니다.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[40rem]">
            <thead>
              <tr className="text-left text-xs text-slate-600 border-b border-slate-300">
                <th className="py-1.5 pr-2 font-normal">결제일</th>
                <th className="py-1.5 pr-2 font-normal">수단</th>
                {kinds && <th className="py-1.5 pr-2 font-normal">구분</th>}
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
                const canceled = r.canceled ?? 0
                const dead = canceled >= r.amount && canceled > 0
                const cancelTip = (r.cancels ?? []).map(c => `취소 ${c.pay_date} −${won(c.amount)}원 · ${c.reason_text ?? '사유 없음'} · ${c.created_by_name ?? ''}`).join('\n')
                return (
                  <Fragment key={r.id}>
                  <tr className={`border-b border-slate-200 align-top ${dead ? 'text-slate-500' : ''}`}>
                    <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">{r.pay_date}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-xs font-medium ${BADGE[r.method]}`}>{SHORT[r.method]}</span>
                    </td>
                    {kinds && (
                      <td className="py-1.5 pr-2 text-xs text-slate-800 whitespace-nowrap">
                        {r.method === 'transfer' ? <span className="text-slate-400">-</span>
                          : kindLabel(r) ?? (<>
                            <span className="inline-block px-1.5 py-0.5 rounded border border-slate-300 bg-slate-50 text-xs text-slate-600">미기재</span>
                            {r.confirmed_at && r.source_kind && <div className="text-xs text-emerald-700 mt-0.5">원본: {r.source_kind}</div>}
                          </>)}
                      </td>
                    )}
                    <td className="py-1.5 pr-2 text-xs text-slate-800">
                      {clueOf(r)}
                      {r.memo && <div className="text-xs text-slate-500">{r.memo}</div>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">
                      <b className={dead ? 'line-through font-normal' : ''}>{won(mine)}</b>
                      {otherNos.length > 0 && (
                        <div className="text-xs text-slate-500" title={otherNos.join(', ')}>결제 {won(r.amount)}원 · 다른 주문 {otherNos.length}건 포함</div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-xs text-slate-800 whitespace-nowrap">
                      {r.created_by_name ?? '-'}
                      <div className="text-xs text-slate-500 tabular-nums">{stamp(r.created_at)}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-xs whitespace-nowrap">
                      {dead ? (
                        <span title={cancelTip} className="inline-block px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-200 text-slate-700 cursor-help">취소됨</span>
                      ) : r.confirmed_at ? (<>
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800">매칭 완료</span>
                        <div className="text-xs text-slate-500 tabular-nums">{r.confirmed_by_name ?? ''} {stamp(r.confirmed_at)}</div>
                      </>) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">매칭 대기</span>
                      )}
                      {!r.confirmed_at && r.last_release && (
                        <div><span title={`매칭 해제 사유: ${r.last_release.text}\n${r.last_release.by ?? ''} · ${stamp(r.last_release.at)}`}
                          className="inline-block mt-0.5 px-1.5 py-0.5 rounded border border-slate-300 text-xs text-slate-600 cursor-help">매칭 해제됨</span></div>
                      )}
                      {!dead && canceled > 0 && (
                        <div><span title={cancelTip} className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-800 cursor-help">부분 취소 · 남은 {won(r.amount - canceled)}</span></div>
                      )}
                      {r.reason_text && (
                        <div><span title={`수정 사유: ${r.reason_text}`} className="inline-block mt-0.5 px-1.5 py-0.5 rounded border border-slate-300 text-xs text-slate-600 cursor-help">수정됨</span></div>
                      )}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {data.can_record && !r.confirmed_at && canceled === 0 && (<>
                        <button onClick={() => openForm(r)} className={btnCls('secondary', 'sm', 'mr-1')}>수정</button>
                      </>)}
                      {data.can_record && data.cancelable && !dead && (
                        <button onClick={() => openAct('cancel', r)} title="실제로 결제를 되돌린 경우 — 기록은 지워지지 않고 취소 줄이 남습니다"
                          className="text-xs px-2 py-0.5 border border-orange-300 rounded text-orange-700 hover:bg-orange-50 mr-1">취소</button>
                      )}
                      {data.can_record && !r.confirmed_at && canceled === 0 && (
                        <button onClick={() => remove(r)} title="잘못 적은 기록을 없앱니다" className={btnCls('secondary', 'sm')}>삭제</button>
                      )}
                      {r.confirmed_at && !data.cancelable && <span className="text-xs text-slate-500">잠김</span>}
                    </td>
                  </tr>
                  {(r.cancels ?? []).map(c => {
                    const cMine = c.orders.find(o => o.order_id === orderId)?.amount ?? 0
                    const tip = `취소 사유: ${c.reason_text ?? '없음'}\n기록: ${c.created_by_name ?? ''} ${stamp(c.created_at)}${c.confirmed_at ? `\n매칭: ${c.confirmed_by_name ?? ''} ${stamp(c.confirmed_at)}` : ''}`
                    return (
                      <tr key={c.id} className="border-b border-slate-200 align-top bg-orange-50/60">
                        <td className="py-1.5 pr-2 pl-3 tabular-nums whitespace-nowrap text-slate-700">└ {c.pay_date}</td>
                        <td className="py-1.5 pr-2"><span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-800">취소</span></td>
                        {kinds && <td className="py-1.5 pr-2"></td>}
                        <td className="py-1.5 pr-2 text-xs text-slate-700">{c.reason_text ?? ''}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap text-red-700"><b>−{won(cMine)}</b>
                          {c.amount !== cMine && <div className="text-xs text-slate-500">취소 {won(c.amount)}원 중</div>}
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-slate-800 whitespace-nowrap">{c.created_by_name ?? '-'}<div className="text-xs text-slate-500 tabular-nums">{stamp(c.created_at)}</div></td>
                        <td className="py-1.5 pr-2 text-xs whitespace-nowrap">
                          <span title={tip} className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold cursor-help ${c.confirmed_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{c.confirmed_at ? '취소 매칭 완료' : '취소 대기'}</span>
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          {data.can_record && !c.confirmed_at && (
                            <button onClick={() => openAct('delete', r, c.id)} className={btnCls('secondary', 'sm')}>삭제</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
