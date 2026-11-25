'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { GRANT_KIND_LABEL, GRANT_SOURCE_LABEL, type GrantKind } from '@/lib/leave-balance'
import { fetchBalance, fmt, type BalanceRes } from './types'

import { btnCls, chipCls } from '@/components/ui/kit'
// 연차 관리 › 부여 내역 — 기본 · 보상 · 이월 · 조정 원장. 엑셀 오른쪽 "보상 일일 연차 · 이월 보상" 표를 대신한다.
// 잘못 넣은 부여는 지우지 않고 "취소"로 남긴다(누가 · 언제 · 왜).
const KIND_TONE: Record<GrantKind, string> = {
  base: 'bg-sky-100 text-sky-800', comp: 'bg-violet-100 text-violet-800',
  carry: 'bg-pink-100 text-pink-800', adjust: 'bg-slate-100 text-slate-800',
}
const KINDS: GrantKind[] = ['comp', 'adjust', 'base', 'carry']
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

export default function GrantsTab() {
  const [year, setYear] = useState(() => Number(today().slice(0, 4)))
  const [data, setData] = useState<BalanceRes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<GrantKind | 'all'>('all')
  const [q, setQ] = useState('')
  const [showCanceled, setShowCanceled] = useState(false)
  const [f, setF] = useState({ employee_id: '', kind: 'comp' as GrantKind, days: '1', grant_date: today(), reason: '' })

  const load = useCallback(async () => {
    const r = await fetchBalance(year)
    setError(r.error); setData(r.data)
  }, [year])
  useEffect(() => { load() }, [load])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    const res = await fetch('/api/attendance/balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); return false }
    return true
  }
  const add = async () => {
    if (!f.employee_id) { flash('직원을 고르세요.'); return }
    if (await post({ action: 'grant_add', ...f, days: Number(f.days) })) {
      const name = data?.employees.find(e => e.id === f.employee_id)?.name ?? ''
      flash(`${name} ${GRANT_KIND_LABEL[f.kind]} ${f.days}일을 부여했습니다.`)
      setF(s => ({ ...s, reason: '' })); load()
    }
  }
  const cancel = async (id: string, label: string) => {
    const note = window.prompt(`${label}\n이 부여를 취소합니다(기록은 남습니다). 취소 사유를 입력하세요 (필수):`)
    if (note === null) return
    if (!note.trim()) { flash('취소 사유를 입력해야 합니다.'); return }
    if (await post({ action: 'grant_cancel', id, note: note.trim() })) { flash('취소했습니다.'); load() }
  }

  const grants = useMemo(() => (data?.grants ?? [])
    .filter(g => showCanceled || g.status === 'active')
    .filter(g => kind === 'all' || g.kind === kind)
    .filter(g => !q.trim() || (g.employee_name ?? '').includes(q.trim()) || (g.reason ?? '').includes(q.trim())), [data, showCanceled, kind, q])
  const inp = 'w-full border border-slate-400 rounded-lg px-2 py-1.5 text-sm'
  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} className={chipCls(on)}>{children}</button>
  )

  return (
    <div>
      {msg && <div className="mb-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">{error}</div>}

      {data?.can_edit && (
        <div className="bg-white border border-slate-300 rounded-xl p-4 mb-3">
          <div className="grid grid-cols-2 lg:grid-cols-[1.3fr_0.8fr_0.6fr_0.9fr_2fr_auto] gap-2 items-end">
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">직원</label>
              <select value={f.employee_id} onChange={e => setF(s => ({ ...s, employee_id: e.target.value }))} className={inp}>
                <option value="">선택…</option>
                {data.employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.team ? ` · ${e.team}` : ''}{e.has_login ? '' : ' (계정 없음)'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">구분</label>
              <select value={f.kind} onChange={e => setF(s => ({ ...s, kind: e.target.value as GrantKind }))} className={inp}>
                {KINDS.map(k => <option key={k} value={k}>{GRANT_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">일수 (0.5 단위)</label>
              <input type="number" step="0.5" value={f.days} onChange={e => setF(s => ({ ...s, days: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">날짜</label>
              <input type="date" value={f.grant_date} onChange={e => setF(s => ({ ...s, grant_date: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">사유 {f.kind === 'comp' || f.kind === 'adjust' ? '(필수)' : '(선택)'}</label>
              <input value={f.reason} onChange={e => setF(s => ({ ...s, reason: e.target.value }))}
                placeholder={f.kind === 'comp' ? '예: 주말근무 · 추석 카탈로그 작업' : f.kind === 'adjust' ? '예: 엑셀 이관 오류 정정 (빼려면 일수에 -)' : ''} className={inp} />
            </div>
            <button onClick={add} disabled={busy} className={btnCls('primary', 'md')}>부여</button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            보상 = 주말근무 · 행사 등으로 주는 연차 · 조정 = 오류 정정(음수 가능, 사유 필수) · 기본 · 이월은 보통 연말 · 연초 정리 탭에서 확정합니다.
            연도는 날짜의 연도로 들어갑니다.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-slate-400 rounded-lg px-2 py-1 text-sm font-semibold">
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름 · 사유 검색" className="border border-slate-400 rounded-lg px-2.5 py-1 text-sm w-44" />
        <div className="flex gap-1">
          <Chip on={kind === 'all'} onClick={() => setKind('all')}>전체</Chip>
          {(['base', 'comp', 'carry', 'adjust'] as GrantKind[]).map(k => <Chip key={k} on={kind === k} onClick={() => setKind(k)}>{GRANT_KIND_LABEL[k]}</Chip>)}
        </div>
        <label className="ml-auto text-xs text-slate-600 flex items-center gap-1.5">
          <input type="checkbox" checked={showCanceled} onChange={e => setShowCanceled(e.target.checked)} /> 취소된 부여도 보기
        </label>
      </div>

      <div className="bg-white border border-slate-300 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-xs text-slate-600 bg-slate-50 border-b border-slate-300">
              <th className="py-2 px-3 text-left font-medium">날짜</th>
              <th className="py-2 px-3 text-left font-medium">직원</th>
              <th className="py-2 px-3 font-medium">구분</th>
              <th className="py-2 px-3 text-right font-medium">일수</th>
              <th className="py-2 px-3 text-left font-medium">사유</th>
              <th className="py-2 px-3 text-left font-medium">출처 · 등록자</th>
              <th className="py-2 px-3 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {grants.map(g => {
              const canceled = g.status === 'canceled'
              return (
                <tr key={g.id} className={`border-b border-slate-200 ${canceled ? 'text-slate-400' : ''}`}>
                  <td className="py-1.5 px-3 tabular-nums text-xs">{g.grant_date}</td>
                  <td className="py-1.5 px-3 font-semibold">{g.employee_name ?? '-'}</td>
                  <td className="py-1.5 px-3 text-center"><span className={`px-2 py-0.5 rounded text-xs font-bold ${canceled ? 'bg-slate-100 text-slate-500' : KIND_TONE[g.kind]}`}>{GRANT_KIND_LABEL[g.kind]}</span></td>
                  <td className={`py-1.5 px-3 text-right tabular-nums ${canceled ? 'line-through' : ''}`}>{fmt(Number(g.days))}</td>
                  <td className="py-1.5 px-3 text-xs">{g.reason ?? ''}{canceled && <span className="block text-red-400">취소: {g.cancel_note ?? ''}{g.canceled_by_name ? ` · ${g.canceled_by_name}` : ''}</span>}</td>
                  <td className="py-1.5 px-3 text-xs text-slate-600">{GRANT_SOURCE_LABEL[g.source]}{g.created_by_name ? ` · ${g.created_by_name}` : ''}</td>
                  <td className="py-1.5 px-3 text-right">
                    {data?.can_edit && !canceled && (
                      <button onClick={() => cancel(g.id, `${g.employee_name} ${GRANT_KIND_LABEL[g.kind]} ${fmt(Number(g.days))}일 (${g.grant_date})`)} disabled={busy}
                        className="text-xs px-2 py-1 border border-slate-400 rounded hover:bg-slate-50">취소</button>
                    )}
                  </td>
                </tr>
              )
            })}
            {!grants.length && <tr><td colSpan={7} className="py-10 text-center text-slate-500 text-sm">부여 내역이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
