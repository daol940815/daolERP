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
  // 주문 금액대는 주문이 있는 곳만 센다 (2026-11-17 사용자 결정) — 최근 2개년 순매출이 0이면 어느 금액대에도 넣지 않는다.
  // (예전에는 주문 없는 곳이 전부 '100만 미만'으로 잡혔다)
  if (cat === 't1' || cat === 't2' || cat === 't3' || cat === 't4') return f.tier === cat && f.total2y > 0
  return f.otype === cat
}

export const OTYPE_META: Record<string, { label: string; cls: string; hint: string }> = {
  both:         { label: '명절+상시', cls: 'bg-violet-100 text-violet-700', hint: '핵심 단골' },
  regular_only: { label: '상시만',   cls: 'bg-blue-100 text-blue-700',     hint: '명절 공략 대상' },
  season_only:  { label: '명절만',   cls: 'bg-amber-100 text-amber-700',   hint: '상시 전환 대상' },
  none:         { label: '주문없음', cls: 'bg-slate-100 text-slate-600',     hint: '인맥 관리' },
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
    // 이 화면 단위의 숫자만 센다 — 지점 화면 = 지점 수, 고객 화면 = 고객 수 (2026-11-17 사용자 결정:
    // 다른 단위 숫자("2 /1명"의 /1명)를 함께 보여 주면 헷갈린다)
    const main = mode === 'vendor' ? flags.vendors : flags.contacts
    const cats: KpiCategory[] = ['new', 'churn', 't1', 't2', 't3', 't4', 'both', 'regular_only', 'season_only', 'none']
    const m: Record<string, number> = {}
    for (const cat of cats) m[cat] = count(main, cat)
    return { m, mainTotal: main.length }
  }, [flags, mode])

  if (!flags || !c) return null
  const unit = mode === 'vendor' ? '곳' : '명'
  const tierSum = TIERS.reduce((a, t) => a + c.m[t.key], 0) || 1
  const click = (cat: KpiCategory) => onFilter(filter === cat ? null : cat)
  const cellCls = (cat: KpiCategory) =>
    `text-left border rounded-lg px-2.5 py-2 hover:border-slate-400 ${filter === cat ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-300'}`

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-slate-800">고객관리 집계</span>
        <span className="inline-flex border border-slate-400 rounded-lg overflow-hidden">
          <Link href="/sales-hub"
            className={`px-3 py-1 text-xs ${mode === 'vendor' ? 'bg-slate-900 text-white font-bold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
            지점 기준
          </Link>
          <Link href="/sales-hub/contacts"
            className={`px-3 py-1 text-xs ${mode === 'contact' ? 'bg-slate-900 text-white font-bold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
            고객 기준
          </Link>
        </span>
        <span className="text-xs text-slate-500">
          기준연도 {flags.y0} 자동 · 타일 클릭 = 목록 필터 · 매출은 최근 2개년 순매출
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.05fr_1.5fr_1.5fr] gap-3">
        {/* 신규 / 이탈 */}
        <div className="bg-white border border-slate-300 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-600">신규 · 이탈</p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button onClick={() => click('new')} className={cellCls('new')}>
              <span className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />신규
              </span>
              <span className="block text-lg font-bold tabular-nums">{c.m['new'].toLocaleString()}{unit}</span>
              <span className="text-xs text-slate-500">최초 주문이 올해</span>
            </button>
            <button onClick={() => click('churn')} className={cellCls('churn')}>
              <span className="text-xs text-slate-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />이탈
              </span>
              <span className="block text-lg font-bold tabular-nums">{c.m['churn'].toLocaleString()}{unit}</span>
              <span className="text-xs text-slate-500">올해 주문 없음</span>
            </button>
          </div>
        </div>

        {/* 주문 금액대 */}
        <div className="bg-white border border-slate-300 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-600">주문 금액대 <span className="text-slate-500">(최근 2개년 누적 · 주문 있는 {mode === 'vendor' ? '곳' : '고객'}만)</span></p>
          <div className="flex h-2 rounded-full overflow-hidden mt-2.5">
            {TIERS.map(t => (
              <div key={t.key} className={t.bar} style={{ width: `${(c.m[t.key] / tierSum) * 100}%` }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {TIERS.map(t => (
              <button key={t.key} onClick={() => click(t.key)}
                className={`flex items-center gap-1.5 text-xs text-slate-700 ${cellCls(t.key)} py-1.5`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${t.bar}`} />
                <span className="truncate">{t.label}</span>
                <span className="ml-auto font-bold text-slate-900 tabular-nums">
                  {c.m[t.key].toLocaleString()}
                  <span className="font-normal text-slate-500 text-xs">{unit}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 주문 유형 */}
        <div className="bg-white border border-slate-300 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-600">주문 유형 <span className="text-slate-500">(명절·상시 조합)</span></p>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {(['both', 'regular_only', 'season_only', 'none'] as KpiCategory[]).map(k => (
              <button key={k} onClick={() => click(k)} className={cellCls(k)}>
                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${OTYPE_META[k].cls}`}>
                  {OTYPE_META[k].label}
                </span>
                <span className="block text-base font-bold tabular-nums mt-0.5">{c.m[k].toLocaleString()}{unit}</span>
                <span className="text-xs text-slate-500">{OTYPE_META[k].hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
