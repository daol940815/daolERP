'use client'

import { getPeriodRange, STANDARD_PRESETS } from '@/lib/period-presets'

// 표준 기간 빠른 선택 행 — 모든 목록·분석 화면이 같은 버튼 세트를 쓴다 (2026-09-30 확정).
// 날짜 from~to 입력은 각 화면의 필터 바에 그대로 두고, 이 행은 그 위에 놓는다.
// 현재 from/to가 어떤 프리셋과 정확히 일치하면 그 버튼이 켜진다.
export default function PeriodPresets({ from, to, onChange, className = '' }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {STANDARD_PRESETS.map(p => {
        const r = getPeriodRange(p)
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
