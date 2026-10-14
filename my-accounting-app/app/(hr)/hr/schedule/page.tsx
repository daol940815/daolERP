'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DOW_LABEL, addDays, dayOfWeek, kstMonthNow, monthDates, monthRange,
  type HolidayMap,
} from '@/lib/attendance'
import {
  KIND_LABEL, sortEvents, spreadByDate,
  type ScheduleEvent, type ScheduleKind,
} from '@/lib/schedule'

// 스케줄 (1단계) — 휴가 · 공휴일 · 아르바이트 근무기간 · 대출 상환일 · 세무 마감을
// 한 달력에서 본다. 입력 화면이 아니라 조회 전용 — 각 항목은 원래 쓰던 화면에서 입력한다.
// 자금 항목(대출·세무)은 회계 조회 권한자에게만 내려온다(서버에서 제외).

interface Res {
  month: string
  today: string
  holidays: HolidayMap
  events: ScheduleEvent[]
  showMoney: boolean
}

const COLOR: Record<ScheduleKind, string> = {
  leave: 'bg-red-100 text-red-700',
  leave_pending: 'bg-red-50 text-red-400 border border-dashed border-red-200',
  parttime: 'bg-violet-100 text-violet-700',
  loan: 'bg-amber-100 text-amber-700',
  tax: 'bg-sky-100 text-sky-700',
  holiday: 'bg-rose-100 text-rose-600',
}
const DOT: Record<ScheduleKind, string> = {
  leave: 'bg-red-500', leave_pending: 'bg-red-200', parttime: 'bg-violet-500',
  loan: 'bg-amber-500', tax: 'bg-sky-500', holiday: 'bg-rose-300',
}
const ALL_KINDS: ScheduleKind[] = ['leave', 'leave_pending', 'parttime', 'loan', 'tax', 'holiday']
const won = (n: number) => n.toLocaleString('ko-KR')

export default function SchedulePage() {
  const [data, setData] = useState<Res | null>(null)
  const [month, setMonth] = useState(kstMonthNow())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [off, setOff] = useState<ScheduleKind[]>([])          // 꺼둔 항목
  const [view, setView] = useState<'month' | 'timeline'>('month')
  const [pickDate, setPickDate] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/schedule?month=${month}`)
    const json = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(json.error ?? '조회 실패'); return }
    setError(null); setData(json); setPickDate(null)
  }, [month])
  useEffect(() => { load() }, [load])

  const toggle = (k: ScheduleKind) =>
    setOff(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k])

  const shown = useMemo(
    () => (data?.events ?? []).filter(e => !off.includes(e.kind)),
    [data, off])
  const byDate = useMemo(
    () => data ? spreadByDate(shown, data.month) : {},
    [shown, data])
  const counts = useMemo(() => {
    const c: Partial<Record<ScheduleKind, number>> = {}
    for (const e of data?.events ?? []) c[e.kind] = (c[e.kind] ?? 0) + 1
    return c
  }, [data])

  // 다가오는 일정 — 오늘부터 14일 (달을 열지 않아도 바로 보이도록)
  const upcoming = useMemo(() => {
    if (!data) return []
    const until = addDays(data.today, 14)
    return Object.entries(byDate)
      .filter(([d]) => d >= data.today && d <= until)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([d, evs]) => evs.map(e => ({ date: d, ev: e })))
      .slice(0, 12)
  }, [byDate, data])

  const moveMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + n, 1))
    setMonth(d.toISOString().slice(0, 7))
  }

  const label = (e: ScheduleEvent) =>
    `${e.who ? `${e.who} · ` : ''}${e.title}${e.amount ? ` ${won(e.amount)}` : ''}`

  // 월 캘린더 칸 — 앞뒤 빈칸을 채워 7열을 맞춘다
  const cells = useMemo(() => {
    if (!data) return []
    const [mStart] = monthRange(data.month)
    const lead = dayOfWeek(mStart)
    const out: (string | null)[] = Array(lead).fill(null)
    out.push(...monthDates(data.month))
    while (out.length % 7) out.push(null)
    return out
  }, [data])

  const pickEvents = pickDate ? (byDate[pickDate] ?? []).slice().sort(sortEvents) : []

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">스케줄</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => moveMonth(-1)} className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">이전</button>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          <button onClick={() => moveMonth(1)} className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">다음</button>
          <button onClick={() => setMonth(kstMonthNow())} className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50 ml-1">이번 달</button>
        </div>
        <div className="flex border border-gray-300 rounded-lg overflow-hidden text-xs font-medium">
          <button onClick={() => setView('month')}
            className={`px-3 py-1.5 ${view === 'month' ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'}`}>월 캘린더</button>
          <button onClick={() => setView('timeline')}
            className={`px-3 py-1.5 ${view === 'timeline' ? 'bg-slate-900 text-white' : 'hover:bg-gray-50'}`}>기간 타임라인</button>
        </div>
      </div>
      <p className="text-sm mt-1 text-gray-500">
        휴가 · 공휴일 · 아르바이트 근무기간 · 대출 상환일 · 세무 마감을 한 달력에서 봅니다.
        입력 화면이 아니라 조회 전용이며, 각 항목은 원래 화면에서 입력한 값이 그대로 따라옵니다.
      </p>

      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 항목 필터 */}
      <div className="flex gap-1.5 flex-wrap my-3">
        {ALL_KINDS.map(k => {
          const n = counts[k] ?? 0
          const on = !off.includes(k)
          if (!data?.showMoney && (k === 'loan' || k === 'tax')) return null
          return (
            <button key={k} onClick={() => toggle(k)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                on ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
              <span className={`w-2 h-2 rounded-sm ${DOT[k]}`} />
              {KIND_LABEL[k]} {n}
            </button>
          )
        })}
      </div>

      {loading ? <div className="text-center py-20 text-gray-400">로딩 중...</div> : data && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            {view === 'month' ? (
              <>
                <div className="grid grid-cols-7 gap-1">
                  {DOW_LABEL.map((d, i) => (
                    <div key={d} className={`text-[11px] font-semibold text-center py-1 ${
                      i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>{d}</div>
                  ))}
                  {cells.map((date, i) => {
                    if (!date) return <div key={`e${i}`} className="min-h-[86px] rounded-lg bg-gray-50/60" />
                    const dow = dayOfWeek(date)
                    const hol = data.holidays[date]
                    const evs = (byDate[date] ?? []).slice().sort(sortEvents)
                    return (
                      <button key={date} onClick={() => setPickDate(date === pickDate ? null : date)}
                        className={`min-h-[86px] text-left rounded-lg border p-1.5 transition-colors ${
                          date === pickDate ? 'border-slate-900 ring-1 ring-slate-900'
                          : hol ? 'bg-rose-50 border-rose-200'
                          : 'border-gray-200 hover:border-gray-300'} ${date === data.today ? 'ring-2 ring-slate-900' : ''}`}>
                        <div className="flex items-baseline gap-1">
                          <span className={`text-xs font-semibold ${
                            hol || dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-600'}`}>
                            {Number(date.slice(8, 10))}
                          </span>
                          {hol && <span className="text-[10px] text-rose-600 font-medium truncate">{hol}</span>}
                        </div>
                        {evs.filter(e => e.kind !== 'holiday').slice(0, 3).map((e, j) => (
                          <span key={j} className={`block rounded px-1 py-0.5 mt-0.5 text-[10px] truncate ${COLOR[e.kind]}`}>
                            {label(e)}
                          </span>
                        ))}
                        {evs.filter(e => e.kind !== 'holiday').length > 3 && (
                          <span className="block text-[10px] text-gray-400 mt-0.5">
                            +{evs.filter(e => e.kind !== 'holiday').length - 3}건
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  날짜를 누르면 오른쪽에 그날 상세가 열립니다. 세무 마감과 대출 상환일이 주말·공휴일이면
                  다음 영업일로 옮겨 표시하고 원래 기한을 함께 적습니다.
                </p>
              </>
            ) : (
              <Timeline data={data} events={shown} />
            )}
          </div>

          {/* 오른쪽 — 선택한 날 상세 또는 다가오는 일정 */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
            {pickDate ? (<>
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-gray-900 text-sm">
                  {pickDate.slice(5)} ({DOW_LABEL[dayOfWeek(pickDate)]})
                </h2>
                <button onClick={() => setPickDate(null)} className="text-xs text-gray-400 hover:text-gray-700">닫기</button>
              </div>
              {data.holidays[pickDate] && (
                <p className="text-xs text-rose-600 font-medium mt-1">{data.holidays[pickDate]}</p>
              )}
              <div className="mt-2 space-y-1.5">
                {pickEvents.filter(e => e.kind !== 'holiday').map((e, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-sm ${DOT[e.kind]}`} />
                      <span className="text-xs font-medium">{e.who ? `${e.who} · ` : ''}{e.title}</span>
                      {e.amount != null && (
                        <span className="ml-auto text-xs tabular-nums font-semibold">{won(e.amount)}</span>
                      )}
                    </div>
                    {e.note && <p className="text-[11px] text-gray-400 mt-0.5">{e.note}</p>}
                  </div>
                ))}
                {!pickEvents.filter(e => e.kind !== 'holiday').length && (
                  <p className="text-xs text-gray-400 py-4 text-center">일정이 없습니다.</p>
                )}
              </div>
            </>) : (<>
              <h2 className="font-bold text-gray-900 text-sm">다가오는 일정 <span className="text-xs font-normal text-gray-400">2주</span></h2>
              <div className="mt-2 space-y-1.5">
                {upcoming.filter(u => u.ev.kind !== 'holiday').map((u, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <span className="tabular-nums text-gray-400 w-10 shrink-0">{u.date.slice(5)}</span>
                    <span className={`w-2 h-2 rounded-sm shrink-0 ${DOT[u.ev.kind]}`} />
                    <span className="truncate">{u.ev.who ? `${u.ev.who} · ` : ''}{u.ev.title}</span>
                    {u.ev.amount != null && (
                      <span className="ml-auto tabular-nums text-gray-600 shrink-0">{won(u.ev.amount)}</span>
                    )}
                  </div>
                ))}
                {!upcoming.filter(u => u.ev.kind !== 'holiday').length && (
                  <p className="text-xs text-gray-400 py-4 text-center">2주 안에 예정된 일정이 없습니다.</p>
                )}
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}

// 기간 타임라인 — 사람·항목을 행으로 놓고 기간을 막대로. 연속 휴가·아르바이트 기간 확인용
function Timeline({ data, events }: { data: Res; events: ScheduleEvent[] }) {
  const dates = monthDates(data.month)
  const last = dates.length
  const col = (d: string) => Number(d.slice(8, 10))

  // 사람이 있는 일정은 사람별로, 없는 일정(세무·대출)은 항목별로 묶는다
  const rows = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>()
    for (const e of events) {
      if (e.kind === 'holiday') continue
      const key = e.who ?? KIND_LABEL[e.kind]
      ;(m.get(key) ?? m.set(key, []).get(key)!).push(e)
    }
    return Array.from(m.entries())
  }, [events])

  if (!rows.length) return <p className="text-sm text-gray-400 py-12 text-center">표시할 일정이 없습니다.</p>

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="grid" style={{ gridTemplateColumns: `110px repeat(${last}, 1fr)` }}>
          <span />
          {dates.map(d => (
            <span key={d} className={`text-[9px] text-center ${
              data.holidays[d] || dayOfWeek(d) === 0 ? 'text-red-400'
              : dayOfWeek(d) === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
              {col(d)}
            </span>
          ))}
        </div>
        {rows.map(([who, evs]) => (
          <div key={who} className="grid items-center border-t border-gray-100"
            style={{ gridTemplateColumns: `110px repeat(${last}, 1fr)` }}>
            <span className="text-xs font-semibold text-gray-700 py-1.5 pr-2 truncate">{who}</span>
            <div className="relative col-span-full col-start-2 h-7">
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${last}, 1fr)` }}>
                {dates.map(d => (
                  <i key={d} className={`border-r border-gray-50 ${
                    data.holidays[d] ? 'bg-rose-50' : [0, 6].includes(dayOfWeek(d)) ? 'bg-gray-50' : ''}`} />
                ))}
              </div>
              {evs.map((e, i) => {
                const s = col(e.date)
                const en = col(e.endDate && e.endDate > e.date ? e.endDate : e.date)
                return (
                  <div key={i}
                    className={`absolute top-1 h-5 rounded text-[10px] leading-5 px-1.5 truncate ${COLOR[e.kind]}`}
                    style={{ left: `${((s - 1) / last) * 100}%`, width: `${((en - s + 1) / last) * 100}%` }}
                    title={`${e.title}${e.note ? ` — ${e.note}` : ''}`}>
                    {e.title}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        회색은 주말, 분홍은 공휴일. 사람이 있는 일정은 직원별 행으로, 세무·대출은 항목 행으로 묶습니다.
      </p>
    </div>
  )
}
