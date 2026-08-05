'use client'

// 대시보드 기간 필터 — URL(?from=&to=)로 서버 컴포넌트에 전달
// 기간 설정 시: 입출금은 기간 내 합계, 잔액은 기간 종료일 기준(기간말 잔액)
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const toDate = (d: Date) => d.toISOString().slice(0, 10)

export default function DashboardPeriodFilter({ from, to }: { from: string | null; to: string | null }) {
  const router = useRouter()
  const [f, setF] = useState(from ?? '')
  const [t, setT] = useState(to ?? '')

  const apply = (nf: string, nt: string) => {
    if (!nf || !nt) return
    router.push(`/?from=${nf}&to=${nt}`)
  }
  const preset = (nf: string, nt: string) => { setF(nf); setT(nt); apply(nf, nt) }

  const now = new Date()
  const monthStart = toDate(new Date(now.getFullYear(), now.getMonth(), 1))
  const prevStart  = toDate(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const prevEnd    = toDate(new Date(now.getFullYear(), now.getMonth(), 0))
  const today      = toDate(now)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input type="date" value={f} onChange={e => setF(e.target.value)}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
      <span className="text-slate-400 text-sm">~</span>
      <input type="date" value={t} onChange={e => setT(e.target.value)}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900" />
      <button onClick={() => apply(f, t)} disabled={!f || !t}
        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-40">
        적용
      </button>
      <button onClick={() => preset(today, today)}
        className="px-2.5 py-1 text-xs border border-slate-300 rounded-md text-slate-600 hover:bg-slate-100">오늘</button>
      <button onClick={() => preset(monthStart, today)}
        className="px-2.5 py-1 text-xs border border-slate-300 rounded-md text-slate-600 hover:bg-slate-100">이번달</button>
      <button onClick={() => preset(prevStart, prevEnd)}
        className="px-2.5 py-1 text-xs border border-slate-300 rounded-md text-slate-600 hover:bg-slate-100">지난달</button>
      {(from || to) && (
        <button onClick={() => { setF(''); setT(''); router.push('/') }}
          className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-600">
          ✕ 기간 해제 (현재 기준)
        </button>
      )}
    </div>
  )
}
