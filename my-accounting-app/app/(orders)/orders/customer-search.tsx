'use client'

import { useEffect, useState } from 'react'
import { contactLabel } from '@/lib/contact-label'
import { similarItems } from '@/lib/similar-name'
import type { CustomerAsg, CustomerHit } from '@/lib/contact-search'
import { branchLabel } from './form-shared'

// 고객 쌍방향 추천 (2026-11-18 사용자 승인 — 시안 docs/mockups/고객_쌍방향추천_시안.html) — 상담일지 · 주문서 공용
//  - 담당자 칸: 이름으로 전체 담당자 검색(소속과 함께) — 콤보 목록 아래 구역으로 붙는다
//  - 핸드폰 칸: 뒷자리 4개부터 후보, 번호 전체 일치 시 한 줄 안내
//  - 고를 때만 채운다(시스템은 추천, 확정은 사용자). 채운 뒤 "되돌리기"
export type { CustomerAsg, CustomerHit }

const digits = (v: string) => v.replace(/\D/g, '')
export const isPhoneLike = (v: string) => /^[\d\s\-()+.]+$/.test(v.trim()) && digits(v).length >= 4

// 검색 — 입력이 멈추고 250ms 뒤 한 번
export function useCustomerSearch(q: string, enabled: boolean) {
  const [hits, setHits] = useState<CustomerHit[]>([])
  const [loading, setLoading] = useState(false)
  const query = q.trim()
  useEffect(() => {
    if (!enabled || query.length < 2) { setHits([]); setLoading(false); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/orders-portal/contact-search?q=${encodeURIComponent(query)}`)
        const json = await res.json().catch(() => ({}))
        if (alive) setHits(res.ok ? (json.hits ?? []) : [])
      } finally { if (alive) setLoading(false) }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [query, enabled])
  return { hits, loading }
}

// 소속 표기: "온양농협 배방지점" (업체 · 지점), 개인 고객은 매출처 이름
export const asgPlace = (a: CustomerAsg) =>
  a.group_name && !a.individual ? [a.group_name, branchLabel(a.vendor_name, a.group_name)].filter(Boolean).join(' ') : a.vendor_name
const tail4 = (p: string | null) => { const d = digits(p ?? ''); return d.length >= 4 ? `…${d.slice(-4)}` : '' }

// 검색 결과 목록 — 사람마다 현재 소속 행(고를 수 있음) + 이전 소속(흐리게, 안내만)
export function CustomerHitList({ hits, loading, heading, staffName, onPick, excludeVendorId, emptyText }: {
  hits: CustomerHit[]
  loading: boolean
  heading: string
  staffName: (id: string | null) => string | null
  onPick: (hit: CustomerHit, asg: CustomerAsg) => void
  excludeVendorId?: string | null     // 이미 고른 지점의 담당자는 위 목록에 있으므로 뺀다
  emptyText?: string
}) {
  const rows = hits.map(h => {
    // 현재 소속(활성 매출처)만 고를 수 있다 — 서버가 비활성 · 병합 · 매입처 소속을 이미 뺐다 (2026-11-19)
    const pickable = h.assignments.filter(a => a.current && a.vendor_id !== excludeVendorId)
    const past = h.assignments.filter(a => !a.current).slice(0, 2)
    return { h, pickable, past }
  }).filter(r => r.pickable.length)
  return (
    <div className="border-t border-slate-200">
      <div className="px-3 py-1.5 text-xs text-slate-500 bg-slate-50">{heading}</div>
      {loading && !rows.length && <div className="px-3 py-2 text-xs text-slate-500">찾는 중...</div>}
      {!loading && !rows.length && <div className="px-3 py-2 text-xs text-slate-500">{emptyText ?? '찾은 담당자가 없습니다'}</div>}
      {rows.map(({ h, pickable, past }) => (
        <div key={h.contact_id} className="border-b border-slate-200">
          {pickable.map(a => {
            const staff = staffName(a.staff_employee_id)
            return (
              <button key={a.vendor_id} type="button" tabIndex={-1}
                onMouseDown={e => e.preventDefault()} onClick={() => onPick(h, a)}
                className={`w-full text-left px-3 py-1.5 hover:bg-blue-50 flex gap-2 items-baseline flex-wrap ${h.exact ? 'bg-blue-50/60' : ''}`}>
                <b className="text-slate-900 text-sm">{contactLabel(h.name, a.title)}</b>
                <span className="text-slate-800 text-xs">{asgPlace(a)}</span>
                {h.assignments.some(x => !x.current) && <span className="px-1.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">현재 소속</span>}
                <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">
                  {[tail4(h.phone) || '번호 없음', staff ? `다올 ${staff}` : '', h.last_order ? `최근 주문 ${h.last_order.slice(5)}` : '주문 없음'].filter(Boolean).join(' · ')}
                </span>
              </button>
            )
          })}
          {past.map(a => (
            <div key={`p-${a.vendor_id}`} className="px-3 pb-1.5 -mt-0.5 text-xs text-slate-500">
              이전 소속 {asgPlace(a)}{a.ended_at ? ` (~${a.ended_at.slice(0, 7)})` : ''}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// 핸드폰 칸 + 후보 목록 (뒷자리 4개부터) — 번호 전체 일치 안내는 폼이 FillBanner로
export function PhoneSearchInput({ value, onChange, disabled, className, placeholder, hits, loading, staffName, onPick, suppress }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className: string
  placeholder: string
  hits: CustomerHit[]
  loading: boolean
  staffName: (id: string | null) => string | null
  onPick: (hit: CustomerHit, asg: CustomerAsg) => void
  suppress?: boolean            // 이미 이 번호의 담당자를 골랐으면 목록을 띄우지 않는다
}) {
  const [focus, setFocus] = useState(false)
  const show = focus && !disabled && !suppress && isPhoneLike(value)
  return (
    <div className="relative">
      <input value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        className={className} placeholder={placeholder} />
      {show && (
        <div className="absolute z-30 right-0 mt-1 w-[34rem] max-w-[90vw] bg-white border border-slate-400 rounded-lg shadow-lg overflow-hidden">
          <CustomerHitList hits={hits} loading={loading} staffName={staffName} onPick={onPick}
            heading={`번호 "${value.trim()}" 담당자 — 고르면 업체 · 지점 · 담당자가 함께 채워집니다`}
            emptyText="이 번호의 담당자가 마스터에 없습니다" />
        </div>
      )}
    </div>
  )
}

// 채운 뒤 안내 · 되돌리기 / 번호 전체 일치 안내 / 지점 불일치 안내
export function FillBanner({ kind, children, actions }: {
  kind: 'green' | 'blue' | 'amber'
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  const cls = kind === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : kind === 'blue' ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-amber-50 border-amber-200 text-amber-800'
  return (
    <div className={`mt-2 flex items-center gap-2 flex-wrap text-xs rounded-lg px-3 py-2 border ${cls}`}>
      <span>{children}</span>
      {actions && <span className="ml-auto flex gap-1.5">{actions}</span>}
    </div>
  )
}
export const bannerBtn = 'px-2 py-0.5 text-xs border border-slate-400 bg-white rounded-md hover:bg-slate-50 whitespace-nowrap'
export const bannerBtnPri = 'px-2 py-0.5 text-xs bg-slate-900 text-white rounded-md hover:bg-slate-800 whitespace-nowrap'

// 비슷한 업체 · 지점 안내 (장면 4) — 같은 곳이면 고르게 하고, 막지는 않는다
export function SimilarHint<T>({ input, items, nameOf, labelOf, onPick, what }: {
  input: string
  items: T[]
  nameOf: (t: T) => string
  labelOf?: (t: T) => string
  onPick: (t: T) => void
  what: '업체' | '지점'
}) {
  if (input.trim().length < 2) return null
  const hits = similarItems(input, items, nameOf)
  if (!hits.length) return null
  return (
    <div className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 flex flex-wrap gap-1 items-center">
      <span>비슷한 {what}가 있습니다 — 같은 곳이면 고르세요:</span>
      {hits.map((t, i) => (
        <button key={i} type="button" onClick={() => onPick(t)}
          className="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
          {(labelOf ?? nameOf)(t)}
        </button>
      ))}
    </div>
  )
}
