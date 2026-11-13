'use client'

import { getMonthPresetRange, MONTH_PRESETS } from '@/lib/period-presets'

// 월 단위 화면의 기간 빠른 선택 행 — PeriodPresets의 월('YYYY-MM') 판 (2026-11-11 승인).
// 월 from~to 입력은 각 화면에 그대로 두고, 이 행의 칩은 그 값을 채운다. 정확히 일치하는 칩이 켜진다.
export default function MonthPresets({ from, to, onChange, className = '' }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {MONTH_PRESETS.map(p => {
        const r = getMonthPresetRange(p)
        const on = from === r.from && to === r.to
        return (
          <button key={p} type="button" onClick={() => onChange(r.from, r.to)}
            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
              on ? 'bg-slate-900 text-white border-slate-900'
                 : 'border-gray-300 text-gray-600 hover:bg-slate-100 hover:border-slate-400'}`}>
            {p}
          </button>
        )
      })}
    </div>
  )
}
