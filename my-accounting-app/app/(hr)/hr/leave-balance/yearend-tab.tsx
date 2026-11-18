'use client'

import { useState } from 'react'
import { fetchBalance, fmt, type BalanceRes, type RecommendRow } from './types'

// 연차 관리 › 연말 · 연초 정리 — 그해 기본 연차와 지난해 보상 잔여(이월)를 추천하고, 체크한 행만 부여로 확정한다.
// 시스템은 추천만, 확정은 인사 · 총무(CLAUDE.md 원칙). 이미 기본 · 이월이 있는 직원은 기본 체크를 끈다(두 번 확정 방지).
// 규칙: 1월 1일 기준 근속 n년 → 15 + (n-1)/2 내림(최대 25), 1년 미만은 그해 돌아오는 입사 월마다 1일.
// 남은 기본 연차는 소멸(표에만 표시), 보상 잔여만 이월(2026-11-18 결정 ④). 초과 사용분은 다음 해로 넘기지 않는다.

type Edit = { checked: boolean; base: string; carry: string }

export default function YearEndTab() {
  const thisYear = Number(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 4))
  const [year, setYear] = useState(thisYear + 1)
  const [data, setData] = useState<BalanceRes | null>(null)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyManaged, setOnlyManaged] = useState(true)

  const make = async () => {
    setBusy(true)
    const r = await fetchBalance(year, true)
    setBusy(false); setError(r.error); setData(r.data)
    const e: Record<string, Edit> = {}
    for (const x of r.data?.recommend ?? []) {
      e[x.employee_id] = {
        checked: x.managed && !x.base_exists,
        base: x.base_exists || x.base_days === null ? '' : String(x.base_days),
        carry: x.carry_exists || !x.carry_days ? '' : String(x.carry_days),
      }
    }
    setEdits(e)
  }
  const confirm = async () => {
    const items = (data?.recommend ?? []).filter(x => edits[x.employee_id]?.checked).map(x => ({
      employee_id: x.employee_id, base_days: Number(edits[x.employee_id].base) || null,
      carry_days: Number(edits[x.employee_id].carry) || null, rule: x.rule,
    }))
    if (!items.length) { setMsg('확정할 직원을 체크하세요.'); return }
    if (!window.confirm(`${year}년 연차를 ${items.length}명에게 부여합니다. 진행할까요?`)) return
    setBusy(true)
    const res = await fetch('/api/attendance/balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recommend_confirm', year, items }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(json.error ?? '확정 실패'); return }
    setMsg(`${json.inserted}건 부여했습니다${json.skipped ? ` (이미 있어 건너뛴 ${json.skipped}건)` : ''}. 부여 내역 탭에서 확인하세요.`)
    make()
  }
  const set = (id: string, patch: Partial<Edit>) => setEdits(s => ({ ...s, [id]: { ...s[id], ...patch } }))
  const rows = (data?.recommend ?? []).filter((x: RecommendRow) => !onlyManaged || x.managed)
  const inp = 'w-16 border border-gray-300 rounded px-1.5 py-0.5 text-sm text-right tabular-nums'

  return (
    <div>
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{error}</div>}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3 text-sm text-gray-600 leading-relaxed">
        연초(1월 1일 무렵)에 한 번 합니다. &ldquo;추천 만들기&rdquo;를 누르면 재직 직원별로 그해 기본 연차(근속 규칙)와 지난해 남은 보상 연차(이월)가 채워집니다.
        숫자를 고칠 수 있고, 체크한 행만 &ldquo;확정&rdquo;으로 부여 내역에 들어갑니다. 지난해 남은 기본 연차는 소멸하므로 표에만 보입니다.
        <div className="flex items-center gap-2 mt-3">
          <select value={year} onChange={e => { setYear(Number(e.target.value)); setData(null) }} className="border border-gray-300 rounded-lg px-2 py-1 text-sm font-semibold">
            {[thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}년 연차</option>)}
          </select>
          <button onClick={make} disabled={busy} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {data ? '추천 다시 만들기' : '추천 만들기'}
          </button>
          {data && (
            <label className="text-xs text-gray-500 flex items-center gap-1.5 ml-2">
              <input type="checkbox" checked={onlyManaged} onChange={e => setOnlyManaged(e.target.checked)} /> 연차 대상(지난해 · 올해 부여 있음)만 보기
            </label>
          )}
          {data?.can_edit && (
            <button onClick={confirm} disabled={busy} className="ml-auto px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">체크한 행 확정</button>
          )}
        </div>
      </div>

      {data && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="py-2 px-3 w-8"></th>
                <th className="py-2 px-3 text-left font-medium">직원</th>
                <th className="py-2 px-3 font-medium">입사일</th>
                <th className="py-2 px-3 text-left font-medium">규칙</th>
                <th className="py-2 px-3 font-medium">기본 연차</th>
                <th className="py-2 px-3 font-medium">이월 (보상 잔여)</th>
                <th className="py-2 px-3 font-medium">{year - 1}년 기본 잔여 (소멸)</th>
                <th className="py-2 px-3 text-left font-medium">메모</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(x => {
                const e = edits[x.employee_id] ?? { checked: false, base: '', carry: '' }
                return (
                  <tr key={x.employee_id} className={`border-b border-gray-50 ${e.checked ? '' : 'text-gray-400'}`}>
                    <td className="py-1.5 px-3 text-center"><input type="checkbox" checked={e.checked} onChange={ev => set(x.employee_id, { checked: ev.target.checked })} /></td>
                    <td className="py-1.5 px-3 font-semibold whitespace-nowrap">{x.name}
                      {!x.has_login && <span className="ml-1 text-[0.625rem] px-1.5 rounded-full bg-slate-100 text-slate-500 font-normal">계정 없음</span>}
                    </td>
                    <td className="py-1.5 px-3 text-center tabular-nums text-xs">{x.hire_date ?? '-'}</td>
                    <td className="py-1.5 px-3 text-xs">{x.rule}</td>
                    <td className="py-1.5 px-3 text-center">
                      {x.base_exists ? <span className="text-xs text-gray-400">이미 부여됨</span>
                        : <input value={e.base} onChange={ev => set(x.employee_id, { base: ev.target.value })} className={inp} />}
                    </td>
                    <td className="py-1.5 px-3 text-center">
                      {x.carry_exists ? <span className="text-xs text-gray-400">이미 이월됨</span>
                        : <input value={e.carry} onChange={ev => set(x.employee_id, { carry: ev.target.value })} className={inp} />}
                    </td>
                    <td className="py-1.5 px-3 text-center tabular-nums">{fmt(x.expire_days)}</td>
                    <td className="py-1.5 px-3 text-xs">
                      {x.prev_over > 0 && <span className="text-red-600">{year - 1}년 초과 {fmt(x.prev_over)}일 (넘기지 않음) </span>}
                      {x.years === 0 && x.hire_date && <span className="text-gray-500">입사 1년이 되는 날 이후 몫은 부여 내역에서 조정으로 넣으세요</span>}
                    </td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={8} className="py-10 text-center text-gray-400 text-sm">대상 직원이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
