'use client'

// 대시보드 기간 줄 — 경영·자금 탭 공통 (2026-11-11 승인). 칩: 오늘 + 표준 세트(최근 7일 ~ 전체 기간).
// 기간은 주소(?from=&to=)로 서버 컴포넌트에 전달하고 탭을 옮겨도 유지된다.
// 자금 탭: 기간이 있으면 입출금은 기간 합계·잔액은 기간말 기준, 없으면 현재 기준(당월 입출금) — '기간 해제'로 돌아간다.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getPeriodRange, STANDARD_PRESETS } from '@/lib/period-presets'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DashboardPeriodBar({ tab, from, to }: { tab: string; from: string | null; to: string | null }) {
  const router = useRouter()
  const [f, setF] = useState(from ?? '')
  const [t, setT] = useState(to ?? '')

  const go = (nf: string | null, nt: string | null) => {
    const p = new URLSearchParams()
    p.set('tab', tab)
    if (nf && nt) { p.set('from', nf); p.set('to', nt) }
    router.push(`/?${p.toString()}`)
  }
  const pick = (nf: string, nt: string) => { setF(nf); setT(nt); go(nf, nt) }

  const today = todayStr()
  const chips: { label: string; from: string; to: string }[] = [
    { label: '오늘', from: today, to: today },
    ...STANDARD_PRESETS.map(p => ({ label: p, ...getPeriodRange(p) })),
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      <div className="flex flex-wrap items-center gap-1">
        {chips.map(c => {
          const on = from === c.from && to === c.to
          return (
            <button key={c.label} type="button" onClick={() => pick(c.from, c.to)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                on ? 'bg-slate-900 text-white border-slate-900'
                   : 'border-gray-300 text-gray-600 hover:bg-slate-100 hover:border-slate-400'}`}>
              {c.label}
            </button>
          )
        })}
      </div>
      <span className="text-gray-300 text-sm">|</span>
      <input type="date" value={f} onChange={e => setF(e.target.value)}
        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
      <span className="text-gray-400 text-xs">~</span>
      <input type="date" value={t} onChange={e => setT(e.target.value)}
        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
      <button type="button" onClick={() => { if (f && t) go(f <= t ? f : t, f <= t ? t : f) }} disabled={!f || !t}
        className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-40">
        적용
      </button>
      {(from || to) && (
        <button type="button" onClick={() => { setF(''); setT(''); go(null, null) }}
          className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600"
          title="기간을 지우면 경영 탭은 당월, 자금 탭은 현재 기준 잔액으로 돌아갑니다">
          ✕ 기간 해제
        </button>
      )}
    </div>
  )
}
