'use client'

import { useRouter } from 'next/navigation'
import { getPeriodRange, PERIOD_PRESETS } from '@/lib/period-presets'

// 경영대시보드 기간 선택 — URL 파라미터로 반영해 서버 컴포넌트가 다시 집계한다
export default function PeriodFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const apply = (f: string, t: string) => {
    if (f && t) router.replace(`/reports/management-dashboard?from=${f}&to=${t}`)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap mt-3">
      <div className="flex flex-wrap items-center gap-1">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => { const r = getPeriodRange(p); apply(r.from, r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
      <span className="w-px h-5 bg-gray-200" />
      <input type="date" value={from} onChange={e => apply(e.target.value, to)}
        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      <span className="text-gray-400 text-sm">~</span>
      <input type="date" value={to} onChange={e => apply(from, e.target.value)}
        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
    </div>
  )
}
