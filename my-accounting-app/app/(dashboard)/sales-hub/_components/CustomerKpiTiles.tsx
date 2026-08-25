'use client'

// 고객관리 집계 KPI 타일 (투트랙 — 지점/담당자 공용)
// 시안: docs/mockups/매출처허브_집계KPI_시안.html (2026-08-24 타일형 확정)
// 타일 클릭 = 목록 필터, 토글 = 지점(/sales-hub) ↔ 담당자(/sales-hub/contacts) 화면 전환.

import Link from 'next/link'
import { useMemo } from 'react'

export type KpiCategory =
  | 'new' | 'churn'
  | 't1' | 't2' | 't3' | 't4'
  | 'both' | 'season_only' | 'regular_only' | 'none'

export interface VendorFlag {
  vendor_id: string
  is_new: boolean
  is_churn: boolean
  otype: 'both' | 'season_only' | 'regular_only' | 'none'
  tier: 't1' | 't2' | 't3' | 't4'
  total2y: number
}
export interface ContactFlag extends VendorFlag {
  contact_id: string
}
export interface KpiFlags {
  y0: number
  vendors: VendorFlag[]
  contacts: ContactFlag[]
}

export function matchCategory(f: VendorFlag, cat: KpiCategory): boolean {
  if (cat === 'new') return f.is_new
  if (cat === 'churn') return f.is_churn
  if (cat === 't1' || cat === 't2' || cat === 't3' || cat === 't4') return f.tier === cat
  return f.otype === cat
}

export const OTYPE_META: Record<string, { label: string; cls: string; hint: string }> = {
  both:         { label: '명절+상시', cls: 'bg-violet-100 text-violet-700', hint: '핵심 단골' },
  regular_only: { label: '상시만',   cls: 'bg-blue-100 text-blue-700',     hint: '명절 공략 대상' },
  season_only:  { label: '명절만',   cls: 'bg-amber-100 text-amber-700',   hint: '상시 전환 대상' },
  none:         { label: '주문없음', cls: 'bg-gray-100 text-gray-500',     hint: '인맥 관리' },
}

const TIERS: { key: KpiCategory; label: string; bar: string }[] = [
  { key: 't1', label: '1,000만 이상',    bar: 'bg-cyan-800' },
  { key: 't2', label: '500만 ~ 1,000만', bar: 'bg-cyan-600' },
  { key: 't3', label: '100만 ~ 500만',   bar: 'bg-cyan-400' },
  { key: 't4', label: '100만 미만',      bar: 'bg-slate-300' },
]

function count(flags: VendorFlag[], cat: KpiCategory) {
  let n = 0
  for (const f of flags) if (matchCategory(f, cat)) n += 1
  return n
}

export default function CustomerKpiTiles({ mode, flags, filter, onFilter }: {
  mode: 'vendor' | 'contact'
  flags: KpiFlags | null
  filter: KpiCategory | null
  onFilter: (c: KpiCategory | null) => void
}) {
  const c = useMemo(() => {
    if (!flags) return null
    const main = mode === 'vendor' ? flags.vendors : flags.contacts
    const sub = mode === 'vendor' ? flags.contacts : flags.vendors
    const cats: KpiCategory[] = ['new', 'churn', 't1', 't2', 't3', 't4', 'both', 'regular_only', 'season_only', 'none']
    const m: Record<string, number> = {}
    const s: Record<string, number> = {}
    for (const cat of cats) { m[cat] = count(main, cat); s[cat] = count(sub, cat) }
    return { m, s, mainTotal: main.length }
  }, [flags, mode])

  if (!flags || !c) return null
  const unit = mode === 'vendor' ? '곳' : '명'
  const subUnit = mode === 'vendor' ? '명' : '곳'
  const tierSum = TIERS.reduce((a, t) => a + c.m[t.key], 0) || 1
  const click = (cat: KpiCategory) => onFilter(filter === cat ? null : cat)
  const cellCls = (cat: KpiCategory) =>
    `text-left border rounded-lg px-2.5 py-2 hover:border-slate-400 ${filter === cat ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200'}`

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-gray-700">고객관리 집계</span>
        <span className="inline-flex border border-gray-300 rounded-lg overflow-hidden">
          <Link href="/sales-hub"
            className={`px-3 py-1 text-xs ${mode === 'vendor' ? 'bg-slate-900 text-white font-bold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            지점 기준
          </Link>
          <Link href="/sales-hub/contacts"
            className={`px-3 py-1 text-xs ${mode === 'contact' ? 'bg-slate-900 text-white font-bold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            담당자 기준
          </Link>
        </span>
        <span className="text-[11px] text-gray-400">
          기준연도 {flags.y0} 자동 · 타일 클릭 = 목록 필터 · 매출은 최근 2개년 순매출
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.05fr_1.5fr_1.5fr] gap-3">
        {/* 신규 / 이탈 */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500">신규 · 이탈</p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button onClick={() => click('new')} className={cellCls('new')}>
              <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />신규
              </span>
              <span className="block text-lg font-bold tabular-nums">{c.m['new'].toLocaleString()}{unit}</span>
              <span className="text-[10px] text-gray-400">{c.s['new'].toLocaleString()}{subUnit} · 최초 주문이 올해</span>
            </button>
            <button onClick={() => click('churn')} className={cellCls('churn')}>
              <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />이탈
              </span>
              <span className="block text-lg font-bold tabular-nums">{c.m['churn'].toLocaleString()}{unit}</span>
              <span className="text-[10px] text-gray-400">{c.s['churn'].toLocaleString()}{subUnit} · 올해 주문 없음</span>
            </button>
          </div>
        </div>

        {/* 주문 금액대 */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500">주문 금액대 <span className="text-gray-400">(최근 2개년 누적)</span></p>
          <div className="flex h-2 rounded-full overflow-hidden mt-2.5">
            {TIERS.map(t => (
              <div key={t.key} className={t.bar} style={{ width: `${(c.m[t.key] / tierSum) * 100}%` }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {TIERS.map(t => (
              <button key={t.key} onClick={() => click(t.key)}
                className={`flex items-center gap-1.5 text-[11px] text-gray-600 ${cellCls(t.key)} py-1.5`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${t.bar}`} />
                <span className="truncate">{t.label}</span>
                <span className="ml-auto font-bold text-gray-900 tabular-nums">
                  {c.m[t.key].toLocaleString()}
                  <span className="font-normal text-gray-400 text-[10px]"> /{c.s[t.key].toLocaleString()}{subUnit}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 주문 유형 */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500">주문 유형 <span className="text-gray-400">(명절·상시 조합)</span></p>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {(['both', 'regular_only', 'season_only', 'none'] as KpiCategory[]).map(k => (
              <button key={k} onClick={() => click(k)} className={cellCls(k)}>
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${OTYPE_META[k].cls}`}>
                  {OTYPE_META[k].label}
                </span>
                <span className="block text-base font-bold tabular-nums mt-0.5">{c.m[k].toLocaleString()}{unit}</span>
                <span className="text-[10px] text-gray-400">{c.s[k].toLocaleString()}{subUnit} · {OTYPE_META[k].hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
