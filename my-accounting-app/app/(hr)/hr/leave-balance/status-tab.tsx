'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { LEAVE_TYPE_LABEL } from '@/lib/attendance'
import { GRANT_KIND_LABEL } from '@/lib/leave-balance'
import ProxyLeaveDialog, { type ProxyEmp } from '@/components/hr/ProxyLeaveDialog'
import { fetchBalance, fmt, type BalanceRes, type BalanceRow } from './types'

import { chipCls } from '@/components/ui/kit'
// 연차 관리 › 현황 — 엑셀 "연차일수" 시트와 같은 표. 행(또는 월 숫자)을 누르면 그 직원의 부여 · 사용 내역이 펼쳐진다.
type Kpi = 'over' | 'nolog' | null
const MONTHS = Array.from({ length: 12 }, (_, i) => i)

export default function StatusTab() {
  const [year, setYear] = useState(() => Number(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 4)))
  const [data, setData] = useState<BalanceRes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('all')
  const [kpi, setKpi] = useState<Kpi>(null)
  const [open, setOpen] = useState<{ id: string; month: number | null } | null>(null)
  const [proxy, setProxy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetchBalance(year)
    setLoading(false); setError(r.error); setData(r.data)
  }, [year])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const teams = useMemo(() => Array.from(new Set(rows.map(r => r.team).filter((t): t is string => !!t))).sort(), [rows])
  const shown = rows
    .filter(r => team === 'all' || r.team === team)
    .filter(r => kpi !== 'over' || r.over > 0)
    .filter(r => kpi !== 'nolog' || !r.has_login)
    .filter(r => !q.trim() || r.name.includes(q.trim()))
  const sum = (f: (r: BalanceRow) => number) => Math.round(rows.reduce((a, r) => a + f(r), 0) * 10) / 10

  const download = () => {
    const head = ['이름', '직함', '팀', '입사일', '기본', '보상', '부여 합계', ...MONTHS.map(m => `${m + 1}월`), '사용 합계', '잔여 기본', '잔여 보상', '잔여 합계', '초과']
    const lines = shown.map(r => [r.name, r.position ?? '', r.team ?? '', r.hire_date ?? '', r.base, r.comp, r.granted, ...r.usedByMonth, r.used, r.remainBase, r.remainComp, r.remainTotal, r.over].join(','))
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `연차현황_${year}.csv`; a.click()
  }

  const Kcard = ({ k, label, value, hint, tone }: { k: Kpi; label: string; value: string; hint: string; tone: string }) => (
    <button onClick={() => k && setKpi(kpi === k ? null : k)} disabled={!k}
      className={`text-left bg-white border rounded-xl px-4 py-3 ${k && kpi === k ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-300'} ${k ? 'hover:border-slate-400' : 'cursor-default'}`}>
      <div className="text-xs text-slate-600 font-semibold">{label}</div>
      <div className={`text-xl font-extrabold mt-0.5 tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{hint}</div>
    </button>
  )
  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} className={chipCls(on)}>{children}</button>
  )

  const overRows = rows.filter(r => r.over > 0)
  return (
    <div>
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{error}</div>}

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-slate-400 rounded-lg px-2 py-1 text-sm font-semibold">
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름 검색" className="border border-slate-400 rounded-lg px-2.5 py-1 text-sm w-40" />
        {teams.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <Chip on={team === 'all'} onClick={() => setTeam('all')}>전체 팀</Chip>
            {teams.map(t => <Chip key={t} on={team === t} onClick={() => setTeam(t)}>{t}</Chip>)}
          </div>
        )}
        <div className="ml-auto flex gap-1.5">
          {data?.can_edit && <button onClick={() => setProxy(true)} className="px-3 py-1.5 border border-slate-400 rounded-lg text-xs font-medium hover:bg-slate-50">휴가 대리 등록</button>}
          <button onClick={download} disabled={!rows.length} className="px-3 py-1.5 border border-slate-400 rounded-lg text-xs font-medium hover:bg-slate-50 disabled:opacity-40">엑셀(CSV) 다운로드</button>
        </div>
      </div>
      {proxy && data && (
        <ProxyLeaveDialog employees={data.employees as ProxyEmp[]} onClose={() => setProxy(false)}
          onDone={m => { setProxy(false); setMsg(m); setTimeout(() => setMsg(null), 4000); load() }} />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <Kcard k="nolog" label="관리 대상" value={`${rows.length}명`} hint={`로그인 계정 없음 ${rows.filter(r => !r.has_login).length}명 (누르면 그분들만)`} tone="text-slate-900" />
        <Kcard k="over" label="초과 사용" value={`${overRows.length}명`} hint={overRows.map(r => `${r.name} ${fmt(r.over)}`).join(' · ') || '없음'} tone="text-red-600" />
        <Kcard k={null} label="보상 연차 잔여" value={`${fmt(sum(r => r.remainComp))}일`} hint="연말에 다음 해로 이월" tone="text-violet-700" />
        <Kcard k={null} label="기본 연차 잔여" value={`${fmt(sum(r => r.remainBase))}일`} hint="12월 31일에 소멸" tone="text-amber-700" />
      </div>

      <div className="bg-white border border-slate-300 rounded-xl overflow-x-auto">
        {loading ? <div className="text-center py-16 text-slate-500">로딩 중...</div> : (
          <table className="w-full text-xs min-w-[1180px]">
            <thead>
              <tr className="text-slate-600 bg-slate-50 border-b border-slate-300">
                <th rowSpan={2} className="py-1.5 px-2 text-left font-medium">이름</th>
                <th rowSpan={2} className="py-1.5 px-2 font-medium">직함</th>
                <th rowSpan={2} className="py-1.5 px-2 font-medium">입사일</th>
                <th colSpan={3} className="py-1.5 px-2 font-medium border-l border-slate-300">부여</th>
                <th colSpan={13} className="py-1.5 px-2 font-medium border-l border-slate-300">사용 (연차 · 반차 · 병가)</th>
                <th colSpan={3} className="py-1.5 px-2 font-medium border-l border-slate-300">잔여</th>
              </tr>
              <tr className="text-slate-600 bg-slate-50 border-b border-slate-300">
                <th className="py-1 px-1.5 font-medium border-l border-slate-300">기본</th><th className="py-1 px-1.5 font-medium">보상</th><th className="py-1 px-1.5 font-medium">합계</th>
                {MONTHS.map(m => <th key={m} className={`py-1 px-1.5 font-medium ${m === 0 ? 'border-l border-slate-300' : ''}`}>{m + 1}월</th>)}
                <th className="py-1 px-1.5 font-medium">합계</th>
                <th className="py-1 px-1.5 font-medium border-l border-slate-300">기본</th><th className="py-1 px-1.5 font-medium">보상</th><th className="py-1 px-1.5 font-medium">합계</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const isOpen = open?.id === r.employee_id
                return (
                  <Fragment key={r.employee_id}>
                    <tr onClick={() => setOpen(isOpen ? null : { id: r.employee_id, month: null })}
                      className={`border-b border-slate-200 cursor-pointer text-center tabular-nums ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50/60'}`}>
                      <td className="py-1.5 px-2 text-left whitespace-nowrap">
                        <span className="font-semibold">{r.name}</span>
                        {!r.has_login && <span className="ml-1 text-xs px-1.5 rounded-full bg-slate-100 text-slate-600">계정 없음</span>}
                      </td>
                      <td className="py-1.5 px-2 text-slate-600">{r.position ?? ''}</td>
                      <td className="py-1.5 px-2 text-slate-600">{r.hire_date ?? '-'}</td>
                      <td className="py-1.5 px-1.5 border-l border-slate-200">{fmt(r.base)}</td>
                      <td className="py-1.5 px-1.5">{fmt(r.comp)}</td>
                      <td className="py-1.5 px-1.5 font-semibold">{fmt(r.granted)}</td>
                      {MONTHS.map(m => (
                        <td key={m} className={`py-1.5 px-1.5 ${m === 0 ? 'border-l border-slate-200' : ''}`}
                          onClick={e => { if (r.usedByMonth[m]) { e.stopPropagation(); setOpen({ id: r.employee_id, month: m }) } }}>
                          {r.usedByMonth[m] ? <span className="underline decoration-dotted underline-offset-2 text-slate-800">{fmt(r.usedByMonth[m])}</span> : <span className="text-slate-200">0</span>}
                        </td>
                      ))}
                      <td className="py-1.5 px-1.5 font-semibold">{fmt(r.used)}</td>
                      <td className="py-1.5 px-1.5 border-l border-slate-200">{fmt(r.remainBase)}</td>
                      <td className="py-1.5 px-1.5">{fmt(r.remainComp)}</td>
                      <td className={`py-1.5 px-1.5 font-semibold ${r.over > 0 ? 'text-red-600' : ''}`}>{r.over > 0 ? `초과 ${fmt(r.over)}` : fmt(r.remainTotal)}</td>
                    </tr>
                    {isOpen && data && (
                      <tr className="bg-slate-50/70 border-b border-slate-200">
                        <td colSpan={22} className="py-3 px-4"><Detail r={r} data={data} month={open?.month ?? null} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!shown.length && <tr><td colSpan={22} className="py-10 text-center text-slate-500 text-sm">{rows.length ? '조건에 맞는 직원이 없습니다.' : '이 해에 부여된 연차가 없습니다. 부여 내역 탭 또는 연말 · 연초 정리 탭에서 부여하세요.'}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        행을 누르면 그 직원의 부여 · 사용 내역이 펼쳐지고, 월 숫자를 누르면 그 달 사용분이 표시됩니다. 초과는 기본과 보상을 모두 쓰고 넘친 일수입니다(신청은 막지 않음).
      </p>
    </div>
  )
}

function Detail({ r, data, month }: { r: BalanceRow; data: BalanceRes; month: number | null }) {
  const grants = data.grants.filter(g => g.employee_id === r.employee_id)
  const leaves = data.leaves.filter(l => l.employee_id === r.employee_id)
    .filter(l => month === null || (l.start_date.slice(5, 7) <= String(month + 1).padStart(2, '0') && l.end_date.slice(5, 7) >= String(month + 1).padStart(2, '0')))
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
      <div>
        <div className="font-bold text-slate-800 mb-1">부여 내역 ({data.year}년)</div>
        {grants.length ? grants.map(g => (
          <div key={g.id} className={`flex gap-2 py-0.5 ${g.status === 'canceled' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            <span className="tabular-nums w-20">{g.grant_date}</span>
            <span className="w-10 font-semibold">{GRANT_KIND_LABEL[g.kind]}</span>
            <span className="tabular-nums w-10 text-right">{fmt(Number(g.days))}</span>
            <span className="truncate">{g.reason ?? ''}</span>
          </div>
        )) : <p className="text-slate-500">부여 없음</p>}
      </div>
      <div>
        <div className="font-bold text-slate-800 mb-1">사용 내역 {month !== null ? `(${month + 1}월)` : `(${data.year}년 전체)`}</div>
        {leaves.length ? leaves.map(l => (
          <div key={l.id} className="flex gap-2 py-0.5 text-slate-800">
            <span className="tabular-nums w-44">{l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''}</span>
            <span className="w-24">{LEAVE_TYPE_LABEL[l.leave_type]}</span>
            <span className="tabular-nums w-10 text-right">{fmt(l.days)}일</span>
            <span className="text-slate-500">{l.source === 'excel' ? '엑셀 이관' : l.source === 'proxy' ? '대리 등록' : '신청'}</span>
          </div>
        )) : <p className="text-slate-500">사용 없음</p>}
        <a href="/hr/leaves" className="inline-block mt-1 text-slate-700 underline">휴가 목록에서 보기</a>
      </div>
    </div>
  )
}
