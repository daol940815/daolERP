'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { btnCls, fieldBox, labelCls } from '@/components/ui/kit'

// 상담 주문 진행 요청 흐름 부품 (2026-11-26 사용자 승인 — 시안 docs/mockups/상담_요청흐름_시안.html)
//  - StaffPickList: 직원 고르기 목록 + 업무량(요청 대기 · 진행 중 주문) — 처음 요청 · 전달 · 재요청 공용
//  - RequestHistory: 요청 → 전달(사유) → 재요청 · 취소 → 처리 불가 · 주문 입력 · 완료 회신
//  - RequestDialog: 전달 · 재요청(받을 직원 + 사유 필수) / 요청 취소(사유 선택)

export interface StaffOpt { id: string; name: string; team: string | null; position: string | null; employment_type?: string | null }
export type Workload = Record<string, { req: number; orders: number }>

export function useWorkload(enabled: boolean): Workload | null {
  const [w, setW] = useState<Workload | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    fetch('/api/orders-portal/workload').then(r => r.json()).then(j => { if (alive) setW(j.workload ?? {}) }).catch(() => null)
    return () => { alive = false }
  }, [enabled])
  return w
}

const pill = (tone: 'req' | 'ord' | 'zero') =>
  `px-2 rounded-full text-xs font-bold whitespace-nowrap ${tone === 'req' ? 'bg-amber-100 text-amber-800' : tone === 'ord' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`

export function StaffPickList({ employees, value, onChange, workload, exclude, noneLabel, disabled }: {
  employees: StaffOpt[]
  value: string
  onChange: (id: string) => void
  workload: Workload | null
  exclude?: (string | null | undefined)[]
  noneLabel?: string            // 맨 위 '요청 안 함' 줄 (처음 요청할 때만)
  disabled?: boolean
}) {
  const list = employees.filter(e => !(exclude ?? []).includes(e.id))
  const sub = (e: StaffOpt) => [e.team, e.employment_type === 'parttime' ? '아르바이트' : e.position].filter(Boolean).join(' · ')
  const row = (sel: boolean) => `w-full text-left flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 last:border-b-0 ${sel ? 'bg-blue-50' : 'hover:bg-slate-50'} disabled:opacity-60`
  return (
    <div className="border border-slate-400 rounded-lg max-h-64 overflow-y-auto bg-white" role="listbox">
      {noneLabel && (
        <button type="button" disabled={disabled} onClick={() => onChange('')} className={row(!value)} role="option" aria-selected={!value}>
          <span className="text-sm text-slate-600">{noneLabel}</span>
        </button>
      )}
      {list.map(e => {
        const w = workload?.[e.id] ?? { req: 0, orders: 0 }
        return (
          <button key={e.id} type="button" disabled={disabled} onClick={() => onChange(e.id)} className={row(value === e.id)} role="option" aria-selected={value === e.id}>
            <span className="text-sm text-slate-900 font-bold">{e.name}</span>
            <span className="text-xs text-slate-600 truncate">{sub(e)}</span>
            <span className="flex-1" />
            {workload && (
              <span className="flex gap-1 shrink-0">
                <span className={pill(w.req ? 'req' : 'zero')}>요청 대기 {w.req}</span>
                <span className={pill(w.orders ? 'ord' : 'zero')}>진행 중 주문 {w.orders}</span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export interface HistoryItem {
  kind: 'request' | 'transfer' | 'rerequest' | 'cancel' | 'unable' | 'order' | 'reply'
  at: string; by: string | null; from: string | null; to: string | null; text: string | null; order_id?: string | null
}
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const DOT: Record<HistoryItem['kind'], string> = {
  request: 'bg-blue-700', rerequest: 'bg-blue-700', transfer: 'bg-orange-700', cancel: 'bg-slate-500',
  unable: 'bg-red-600', order: 'bg-emerald-700', reply: 'bg-emerald-700',
}
function headline(h: HistoryItem): string {
  switch (h.kind) {
    case 'request': return `${h.by ?? ''} → ${h.to ?? ''} 요청`
    case 'rerequest': return `${h.by ?? ''} → ${h.to ?? ''} 재요청${h.from ? ` (이전 ${h.from})` : ''}`
    case 'transfer': return `${h.from ?? h.by ?? ''} → ${h.to ?? ''} 전달`
    case 'cancel': return `${h.by ?? ''} 요청 취소${h.from ? ` (진행자 ${h.from})` : ''}`
    case 'unable': return `${h.by ?? ''} 처리 불가 회신`
    case 'order': return `${h.by ?? ''} 주문 입력`
    case 'reply': return `${h.by ?? ''} 완료 회신`
  }
}
function textLabel(h: HistoryItem): string | null {
  if (!h.text) return null
  if (h.kind === 'request') return `메모: ${h.text}`
  if (h.kind === 'order' || h.kind === 'reply') return h.text
  return `사유: ${h.text}`
}

export function RequestHistory({ items, current }: { items: HistoryItem[]; current?: string | null }) {
  if (!items.length) return null
  return (
    <ol className="list-none m-0 p-0">
      {items.map((h, i) => (
        <li key={i} className="relative pl-6 pb-3 last:pb-0">
          {i < items.length - 1 && <span className="absolute left-[0.4375rem] top-4 bottom-0 w-0.5 bg-slate-300" aria-hidden="true" />}
          <span className={`absolute left-0 top-1 w-4 h-4 rounded-full border-[3px] border-white ring-1 ring-slate-400 ${DOT[h.kind]}`} aria-hidden="true" />
          <span className="text-sm font-bold text-slate-900">{headline(h)}</span>
          <span className="ml-1.5 text-xs text-slate-600 tabular-nums">{when(h.at)}</span>
          {h.order_id && h.kind === 'order' && <a href={`/orders/${h.order_id}`} className="ml-1.5 text-xs text-blue-700 hover:underline">주문 보기</a>}
          {textLabel(h) && <div className="mt-0.5 text-sm text-slate-700 bg-slate-100 rounded-lg px-2.5 py-1 inline-block whitespace-pre-line">{textLabel(h)}</div>}
        </li>
      ))}
      {current && (
        <li className="relative pl-6">
          <span className="absolute left-0 top-1 w-4 h-4 rounded-full bg-white ring-2 ring-orange-700" aria-hidden="true" />
          <span className="text-sm font-bold text-slate-900">{current} 진행 중</span>
          <span className="ml-1.5 text-xs text-slate-600">주문서 전환 전</span>
        </li>
      )}
    </ol>
  )
}

// 전달 · 재요청 · 취소 창
export function RequestDialog({ mode, employees, workload, exclude, currentName, requesterName, busy, onSubmit, onClose }: {
  mode: 'transfer' | 'rerequest' | 'cancel'
  employees: StaffOpt[]
  workload: Workload | null
  exclude?: (string | null | undefined)[]
  currentName: string | null       // 지금 진행자
  requesterName: string | null
  busy: boolean
  onSubmit: (to: string | null, reason: string) => void
  onClose: () => void
}) {
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const needTo = mode !== 'cancel'
  const needReason = mode !== 'cancel'
  const ok = (!needTo || !!to) && (!needReason || !!reason.trim())
  const title = mode === 'transfer' ? '다른 직원에게 전달' : mode === 'rerequest' ? '다른 직원에게 재요청' : '요청 취소'
  const desc = mode === 'transfer'
    ? <>전달하면 이 상담이 내 &lsquo;나에게 요청됨&rsquo;에서 빠집니다. 받을 직원과 요청자{requesterName ? `(${requesterName})` : ''}에게 알림이 갑니다.</>
    : mode === 'rerequest'
      ? <>{currentName ? <>지금 진행자 {currentName}에게는 &ldquo;다른 직원에게 넘어갔습니다&rdquo; 알림이 갑니다. </> : null}새로 받을 직원에게 사유와 함께 알림이 갑니다.</>
      : <>취소하면 이 상담은 내가 직접 진행하는 상태로 돌아가고{currentName ? <>, 진행자 {currentName}에게 &ldquo;요청이 취소됐습니다&rdquo; 알림이 갑니다</> : null}. 진행 이력에 남습니다.</>
  return (
    <Modal title={title} desc={desc} onClose={onClose} size="lg"
      footer={<>
        <button type="button" onClick={onClose} className={btnCls('secondary', 'md')}>닫기</button>
        <button type="button" disabled={!ok || busy} onClick={() => onSubmit(needTo ? to : null, reason.trim())}
          className={btnCls(mode === 'cancel' ? 'danger' : 'primary', 'md')}>
          {busy ? '처리 중...' : mode === 'transfer' ? '전달' : mode === 'rerequest' ? '재요청' : '요청 취소'}
        </button>
      </>}>
      {needTo && (
        <div className="mb-3">
          <div className={labelCls}>받을 직원 <span className="font-normal text-slate-600">— 요청 대기 · 진행 중 주문(발주 미완료) 수</span></div>
          <StaffPickList employees={employees} value={to} onChange={setTo} workload={workload} exclude={exclude} />
        </div>
      )}
      <div>
        <div className={labelCls}>{mode === 'transfer' ? '전달 사유' : mode === 'rerequest' ? '재요청 사유' : '취소 사유'}{' '}
          {needReason ? <span className="text-red-600">(필수)</span> : <span className="font-normal text-slate-600">(선택)</span>}</div>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder={mode === 'cancel' ? '예: 고객이 주문을 미뤘습니다' : '요청자가 진행 이력에서 봅니다'}
          className={fieldBox({ area: true })} />
      </div>
    </Modal>
  )
}
