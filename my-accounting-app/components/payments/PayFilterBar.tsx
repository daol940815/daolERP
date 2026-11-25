'use client'

import { useCallback, useEffect, useState } from 'react'
import PeriodPresets from '@/components/ui/PeriodPresets'
import { getPeriodRange } from '@/lib/period-presets'

// 결제 확인 공통 필터 줄 (2026-11-18 실무자 요청 — 시안 docs/mockups/결제확인_탭5개_시안.html)
// 전체 현황 · 매칭 대기 · 결제 안내 대상 세 탭이 같은 줄을 쓰고, 탭을 옮겨도 조건이 유지된다(브라우저 탭을 닫을 때까지 — sessionStorage).
//   기간 칩(기본 전체 기간) / 검색(항목 선택 + 검색어, 왼쪽) / 날짜 / 지점 담당(기본 = 로그인한 직원)
//   지점 담당 필터와 칩(내 담당 · 전체 · 담당 미지정)은 하나의 조건 — 칩은 필터 값을 바꾸는 바로가기다.
//   담당 지점이 하나도 없는 사람은 처음부터 '전체'로 열린다.
export type SearchField = 'all' | 'vendor' | 'order' | 'manager' | 'approval' | 'depositor' | 'amount'
export const SEARCH_FIELDS: { key: SearchField; label: string }[] = [
  { key: 'all', label: '전체' }, { key: 'vendor', label: '매출처' }, { key: 'order', label: '주문번호' }, { key: 'manager', label: '고객' },
  { key: 'approval', label: '승인번호' }, { key: 'depositor', label: '입금자' }, { key: 'amount', label: '금액' },
]
export interface PayFilter { from: string; to: string; staff: string; field: SearchField; q: string }   // staff: 'all' | 'none' | 직원 id
export interface StaffScope { me: { id: string | null; name: string | null; has_vendors: boolean }; options: { id: string; name: string }[] }

const KEY = 'daol-pay-filter'
const allRange = () => getPeriodRange('전체 기간')

export function usePayFilter() {
  const [filter, setFilter] = useState<PayFilter>(() => ({ ...allRange(), staff: '', field: 'all', q: '' }))   // staff '' = 아직 기본값을 정하지 않음
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let next: Partial<PayFilter> = {}
    try { next = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<PayFilter> } catch { /* 저장소를 못 쓰면 기본값 */ }
    // 다른 탭에서 "…에서 열기"로 넘어온 검색어 (?q=주문번호)
    const q = new URLSearchParams(window.location.search).get('q')
    setFilter(f => ({ ...f, ...next, ...(q ? { q, field: 'order' as SearchField } : {}) }))
    setReady(true)
  }, [])
  const update = useCallback((patch: Partial<PayFilter>) => setFilter(f => {
    const n = { ...f, ...patch }
    try { sessionStorage.setItem(KEY, JSON.stringify(n)) } catch { /* 무시 */ }
    return n
  }), [])
  // 지점 담당 기본값: 저장된 값이 없으면 내 담당(담당 지점이 없으면 전체)
  const applyScope = useCallback((scope: StaffScope | null | undefined) => {
    if (!scope) return
    setFilter(f => (f.staff ? f : { ...f, staff: scope.me.has_vendors && scope.me.id ? scope.me.id : 'all' }))
  }, [])
  return { filter, update, applyScope, ready }
}

// 한 줄이 조건에 맞는가. fields: 검색 항목별 문자열(없는 항목은 생략)
export function passPayFilter(f: PayFilter, row: { staff_ids?: string[]; date: string; fields: Partial<Record<Exclude<SearchField, 'all'>, string | null | undefined>> }): boolean {
  if (f.from && row.date < f.from) return false
  if (f.to && row.date > f.to) return false
  const ids = row.staff_ids ?? []
  if (f.staff === 'none' ? ids.length > 0 : f.staff && f.staff !== 'all' ? !ids.includes(f.staff) : false) return false
  const q = f.q.trim().toLowerCase()
  if (!q) return true
  const hit = (v: string | null | undefined, digits = false) => !!v && (digits ? v.replace(/[^0-9]/g, '').includes(q.replace(/[^0-9]/g, '')) && q.replace(/[^0-9]/g, '') !== '' : v.toLowerCase().includes(q))
  if (f.field === 'all') return Object.entries(row.fields).some(([k, v]) => hit(v, k === 'amount'))
  return hit(row.fields[f.field], f.field === 'amount')
}

export default function PayFilterBar({ filter, update, scope, noneCount }: {
  filter: PayFilter; update: (p: Partial<PayFilter>) => void; scope: StaffScope | null; noneCount?: number
}) {
  const [text, setText] = useState(filter.q)
  useEffect(() => { setText(filter.q) }, [filter.q])
  const meId = scope?.me.id ?? null
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border whitespace-nowrap ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-50'}`}>{label}</button>
  )
  const inputCls = 'border border-slate-400 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900'
  return (
    <div className="mb-3">
      <PeriodPresets from={filter.from} to={filter.to} onChange={(from, to) => update({ from, to })} className="mb-2" />
      <div className="flex items-center gap-1.5 flex-wrap">
        <select value={filter.field} onChange={e => update({ field: e.target.value as SearchField })} className={inputCls} aria-label="검색 항목">
          {SEARCH_FIELDS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') update({ q: text }) }} onBlur={() => { if (text !== filter.q) update({ q: text }) }}
          placeholder="검색어 입력 후 Enter" className={`${inputCls} w-56 max-w-full`} />
        {filter.q && <button type="button" onClick={() => update({ q: '' })} className="text-xs text-slate-600 underline">검색 지우기</button>}
        <input type="date" value={filter.from} onChange={e => update({ from: e.target.value })} className={inputCls} aria-label="시작일" />
        <span className="text-slate-500">~</span>
        <input type="date" value={filter.to} onChange={e => update({ to: e.target.value })} className={inputCls} aria-label="종료일" />
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <select value={filter.staff || 'all'} onChange={e => update({ staff: e.target.value })} className={inputCls} aria-label="지점 담당">
          <option value="all">지점 담당: 전체</option>
          <option value="none">지점 담당: 담당 미지정</option>
          {(scope?.options ?? []).map(o => <option key={o.id} value={o.id}>지점 담당: {o.name}{o.id === meId ? ' (나)' : ''}</option>)}
        </select>
        {scope?.me.has_vendors && meId && chip(filter.staff === meId, '내 담당', () => update({ staff: meId }))}
        {chip(filter.staff === 'all' || !filter.staff, '전체', () => update({ staff: 'all' }))}
        {chip(filter.staff === 'none', `담당 미지정${noneCount != null ? ` ${noneCount}` : ''}`, () => update({ staff: 'none' }))}
      </div>
    </div>
  )
}
