'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  LEAVE_TYPE_LABEL, leavePeriodText,
  type AttendanceLeave, type LeaveType,
} from '@/lib/attendance'
import {
  STEPS, STEP_ACTION_LABEL, emptyRoster, progressLabel, turnLevel,
  type ApproveLevel, type ApproverRoster, type LeaveActions, type LeaveStep,
} from '@/lib/leave-approval'
import { defaultRange } from '@/lib/period-presets'
import PeriodPresets from '@/components/ui/PeriodPresets'
import LeaveSteps from '@/components/hr/LeaveSteps'
import { requestNotifRefresh, useNotifRefresh } from '@/lib/use-notif-refresh'

// 휴가 목록 (2026-11-04 — 승인 대기 · 처리 내역을 한 목록으로 통합, 3단계 결재 · 전결)
// 전 직원이 본다. 처리 버튼은 서버가 행마다 내려주는 actions 대로만 보인다(실제 차단은 API).
// 사유는 본인 · 결재 권한자 · 인사·총무 수정 권한자에게만 내려온다.
// 시안: docs/mockups/휴가목록_3단계결재_시안.html

type Row = AttendanceLeave & {
  employee: { name: string; team: string | null } | null
  decided_by_name: string | null
  decided_at: string | null
  days: number
  reason_hidden: boolean
  steps: LeaveStep[]
  current_step: ApproveLevel | null
  actions: LeaveActions & { cancel: boolean; cancel_approved: boolean }
}
interface Res {
  leaves: Row[]
  myEmployeeId: string
  myLevel: ApproveLevel | null
  stepsReady: boolean
  roster: ApproverRoster
  can_edit: boolean
}
type Kpi = 'turn' | 'mine' | 'requested' | 'approved' | 'rejected' | 'canceled'
type TypeChip = 'all' | 'annual' | 'half' | 'sick' | 'official' | 'other'
const TYPE_CHIPS: [TypeChip, string][] = [['all', '전체 종류'], ['annual', '연차'], ['half', '반차'], ['sick', '병가'], ['official', '공가'], ['other', '기타']]
const typeOf = (t: LeaveType): TypeChip => (t === 'half_am' || t === 'half_pm' ? 'half' : t)

const kst = (iso: string | null | undefined, withTime = false) => {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString()
  return withTime ? `${d.slice(0, 10)} ${d.slice(11, 16)}` : `${d.slice(5, 7)}/${d.slice(8, 10)}`
}
const STATUS_BADGE: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600', canceled: 'bg-gray-100 text-gray-500',
}

export default function LeaveListPage() {
  const init = defaultRange('analysis')     // 당년
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [data, setData] = useState<Res | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [typeChip, setTypeChip] = useState<TypeChip>('all')
  const [team, setTeam] = useState<string>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    const res = await fetch(`/api/attendance/leaves?scope=all&from=${from}&to=${to}`)
    const json = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(json.error ?? '조회 실패'); return }
    setError(null); setData(json)
  }, [from, to])
  useEffect(() => { setLoading(true); load() }, [load])
  useNotifRefresh(load)

  const rows = useMemo(() => data?.leaves ?? [], [data])
  const me = data?.myEmployeeId ?? null
  const approver = !!data && (data.stepsReady ? !!data.myLevel : rows.some(r => r.actions.approve))
  const roster = data?.roster ?? emptyRoster()

  const counts = useMemo(() => ({
    turn: rows.filter(r => r.actions.myTurn).length,
    mine: rows.filter(r => r.employee_id === me).length,
    requested: rows.filter(r => r.status === 'requested').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    canceled: rows.filter(r => r.status === 'canceled').length,
  }), [rows, me])

  const teams = useMemo(() => Array.from(new Set(rows.map(r => r.employee?.team).filter((t): t is string => !!t))).sort(), [rows])

  const shown = useMemo(() => {
    const kw = q.trim()
    return rows
      .filter(r => !kpi
        || (kpi === 'turn' ? r.actions.myTurn : kpi === 'mine' ? r.employee_id === me : r.status === kpi))
      .filter(r => typeChip === 'all' || typeOf(r.leave_type) === typeChip)
      .filter(r => team === 'all' || r.employee?.team === team)
      .filter(r => !kw || (r.employee?.name ?? '').includes(kw) || (r.reason ?? '').includes(kw))
      // 내 차례 → 진행 중 → 나머지(신청 최신순)
      .sort((a, b) => Number(b.actions.myTurn) - Number(a.actions.myTurn)
        || Number(b.status === 'requested') - Number(a.status === 'requested')
        || b.created_at.localeCompare(a.created_at))
  }, [rows, kpi, typeChip, team, q, me])

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true)
    const res = await fetch('/api/attendance/leaves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); load(); return }
    flash(json.approved ? `${ok} 최종 승인되었습니다.` : ok)
    load(); requestNotifRefresh()
  }

  const who = (r: Row) => `${r.employee?.name ?? ''} ${LEAVE_TYPE_LABEL[r.leave_type]} (${leavePeriodText(r, r.days)})`

  const approve = (r: Row) => {
    const s = r.current_step
    const lv = data?.myLevel
    // 상위 결재 — 처리자 단계까지 한 번에 통과한다는 것을 알린다
    const span = data?.stepsReady && s && lv && lv > s ? STEPS.filter(x => x >= s && x <= lv && !r.steps.some(y => y.step === x)) : []
    const text = span.length > 1 ? `${span.join(' · ')}차를 함께 승인합니다.` : '승인합니다.'
    if (!window.confirm(`${who(r)}\n${text}`)) return
    post({ action: 'approve', id: r.id }, '승인했습니다.')
  }
  const proxy = (r: Row) => {
    const note = window.prompt(`${who(r)}\n3차 결재를 전결합니다 (3차 권한자 부재 시).\n전결 사유를 입력하세요 (필수):`)
    if (note === null) return
    if (!note.trim()) { flash('전결 사유를 입력해야 합니다.'); return }
    post({ action: 'proxy', id: r.id, note: note.trim() }, '3차 전결로 승인했습니다.')
  }
  const reject = (r: Row) => {
    const note = window.prompt(`${who(r)}\n반려합니다. 반려 사유를 입력하세요 (선택):`)
    if (note === null) return
    post({ action: 'reject', id: r.id, note: note.trim() }, '반려했습니다.')
  }
  const cancel = (r: Row) => {
    if (!window.confirm(`${who(r)}\n이 휴가 신청을 취소할까요?`)) return
    post({ action: 'cancel', id: r.id }, '신청을 취소했습니다.')
  }
  const cancelApproved = (r: Row) => {
    const note = window.prompt(`${who(r)}\n승인을 취소합니다. 취소 사유를 입력하세요 (필수):`)
    if (note === null) return
    if (!note.trim()) { flash('취소 사유를 입력해야 합니다.'); return }
    post({ action: 'cancel', id: r.id, note: note.trim() }, '승인을 취소했습니다. 해당 날짜는 다시 근무일로 계산됩니다.')
  }

  const missingLevels = data?.stepsReady ? STEPS.filter(l => !roster[l].length) : []

  const KpiCard = ({ k, label, tone }: { k: Kpi; label: string; tone: string }) => (
    <button onClick={() => setKpi(kpi === k ? null : k)}
      className={`text-left bg-white border rounded-xl px-4 py-3 transition-colors ${kpi === k ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:border-gray-300'}`}>
      <div className="text-xs text-gray-500 font-semibold">{label}</div>
      <div className={`text-xl font-extrabold mt-0.5 tabular-nums ${tone}`}>{counts[k]}</div>
    </button>
  )
  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{children}</button>
  )

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900">휴가 목록</h1>
      <p className="text-sm text-gray-500 mt-1">
        전 직원의 휴가 신청과 결재 진행을 한 목록에서 봅니다. 내 차례인 건은 노란 줄로 표시되고 그 줄에서 바로 처리합니다.
        휴가 신청은 <Link href="/hr/attendance" className="underline">근태 · 휴가</Link>에서 합니다.
      </p>
      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {data && !data.stepsReady && (
        <div className="my-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          3단계 결재(204 마이그레이션)가 아직 적용되지 않아 기존 1단계 승인으로 동작합니다.
        </div>
      )}
      {missingLevels.length > 0 && (
        <div className="my-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          휴가 결재 {missingLevels.join(' · ')}차 권한자가 지정되지 않았습니다.
          {missingLevels.includes(3) ? ' 3차가 없으면 모든 휴가가 2차 전결로만 끝납니다.' : ' 그 단계는 다음 상위 단계 권한자 차례로 넘어갑니다.'}
          {' '}지정은 직원 · 계정 · 권한 화면에서 마스터 계정이 합니다.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
        {approver ? <KpiCard k="turn" label="내 차례" tone="text-amber-600" /> : <KpiCard k="mine" label="내 신청" tone="text-slate-900" />}
        <KpiCard k="requested" label="진행 중" tone="text-slate-900" />
        <KpiCard k="approved" label="승인" tone="text-green-700" />
        <KpiCard k="rejected" label="반려" tone="text-red-600" />
        <KpiCard k="canceled" label="취소" tone="text-gray-500" />
      </div>

      <PeriodPresets from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} className="mt-3" />
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름 · 사유 검색"
          className="border border-gray-300 rounded-lg px-2.5 py-1 text-sm w-44" />
        <div className="flex gap-1 flex-wrap">
          {TYPE_CHIPS.map(([k, label]) => <Chip key={k} on={typeChip === k} onClick={() => setTypeChip(k)}>{label}</Chip>)}
        </div>
        {teams.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <Chip on={team === 'all'} onClick={() => setTeam('all')}>전체 팀</Chip>
            {teams.map(t => <Chip key={t} on={team === t} onClick={() => setTeam(t)}>{t}</Chip>)}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">신청자</th>
                <th className="py-2 px-3 text-left font-medium">종류</th>
                <th className="py-2 px-3 text-left font-medium">기간 · 일수</th>
                <th className="py-2 px-3 text-left font-medium">결재 진행</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
                <th className="py-2 px-3 text-left font-medium">사유</th>
                <th className="py-2 px-3 text-left font-medium">신청일</th>
                <th className="py-2 px-3 text-right font-medium">처리</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const mine = r.employee_id === me
                const a = r.actions
                const isOpen = open === r.id
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => setOpen(isOpen ? null : r.id)}
                      className={`border-b border-gray-50 cursor-pointer ${a.myTurn ? 'bg-amber-50/70' : 'hover:bg-gray-50/60'}`}>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="font-semibold">{r.employee?.name ?? '-'}</span>
                        {r.employee?.team && <span className="ml-1.5 text-[11px] text-gray-400">{r.employee.team}</span>}
                        {mine && <span className="ml-1.5 text-[10px] px-1.5 rounded-full bg-amber-100 text-amber-800 font-bold">본인</span>}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">{LEAVE_TYPE_LABEL[r.leave_type]}</td>
                      <td className="py-2 px-3 tabular-nums text-xs whitespace-nowrap">{leavePeriodText(r, r.days)}</td>
                      <td className="py-2 px-3">
                        <LeaveSteps steps={r.steps} status={r.status} myTurn={a.myTurn} roster={roster}
                          applicantId={r.employee_id} decidedByName={r.decided_by_name} stepsReady={!!data?.stepsReady} />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_BADGE[r.status]}`}>
                          {progressLabel(r.status, r.steps, !!data?.stepsReady)}
                        </span>
                        {r.status !== 'requested' && r.decided_at && <span className="ml-1.5 text-[11px] text-gray-400">{kst(r.decided_at)}</span>}
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-600 max-w-[220px]">
                        {r.reason_hidden ? <span className="text-gray-300">-</span> : (r.reason ?? <span className="text-gray-300">-</span>)}
                        {r.decide_note && <span className="text-gray-400"> · {r.status === 'rejected' ? '반려' : '처리'}: {r.decide_note}</span>}
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-400 tabular-nums whitespace-nowrap">{kst(r.created_at)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {a.approve && <button onClick={() => approve(r)} disabled={busy}
                          className="text-xs px-2.5 py-1 bg-slate-900 text-white rounded mr-1 hover:bg-slate-700 disabled:opacity-50">승인</button>}
                        {a.proxy && <button onClick={() => proxy(r)} disabled={busy}
                          className="text-xs px-2.5 py-1 border border-violet-300 bg-violet-50 text-violet-700 rounded mr-1 hover:bg-violet-100 disabled:opacity-50">3차 전결</button>}
                        {a.reject && <button onClick={() => reject(r)} disabled={busy}
                          className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded mr-1 hover:bg-red-50 disabled:opacity-50">반려</button>}
                        {mine && r.status === 'requested' && <span className="text-[11px] text-gray-400 mr-1.5">본인 건 결재 불가</span>}
                        {a.cancel && <button onClick={() => cancel(r)} disabled={busy}
                          className="text-xs px-2.5 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">신청 취소</button>}
                        {a.cancel_approved && <button onClick={() => cancelApproved(r)} disabled={busy}
                          className="text-xs px-2.5 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">승인 취소</button>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70 border-b border-gray-100">
                        <td colSpan={8} className="py-2.5 pl-10 pr-4">
                          <History r={r} roster={roster} stepsReady={!!data?.stepsReady} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!shown.length && (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400 text-sm">조건에 맞는 휴가가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        행을 누르면 단계별 결재 이력이 펼쳐집니다. 상위 결재 = 상위 단계 권한자가 하위 단계를 함께 처리 · 자동 통과 = 신청자 본인 단계 이하 ·
        신청자 전결 = 신청할 때 넘긴 단계 · 전결 = 3차 권한자 부재 시 2차 권한자가 처리.
      </p>
    </div>
  )
}

function History({ r, roster, stepsReady }: { r: Row; roster: ApproverRoster; stepsReady: boolean }) {
  const pending = r.status === 'requested' ? r.current_step : null
  return (
    <div className="text-xs leading-7 text-gray-700">
      <div><b className="inline-block w-12 text-gray-500">신청</b>{r.employee?.name} · {kst(r.created_at, true)}
        {r.reason && <> · 사유 &ldquo;{r.reason}&rdquo;</>}
      </div>
      {stepsReady && STEPS.map(st => {
        const row = r.steps.find(x => x.step === st)
        if (row) {
          const up = row.action === 'approve' && (row.actor_level ?? st) > st
          return (
            <div key={st}><b className="inline-block w-12 text-gray-500">{st}차</b>
              {row.action === 'auto' || row.action === 'skip' ? `${STEP_ACTION_LABEL[row.action]}` : `${row.actor_name ?? ''} ${up ? '상위 결재' : STEP_ACTION_LABEL[row.action]}`}
              {' · '}{kst(row.created_at, true)}
              {row.note && <span className="text-gray-500"> · 사유 &ldquo;{row.note}&rdquo;</span>}
            </div>
          )
        }
        if (pending === st) {
          const lv = turnLevel(st, roster, r.employee_id)
          const names = lv ? roster[lv].filter(p => p.id !== r.employee_id).map(p => `${p.name}${p.position ? ` ${p.position}` : ''}`) : []
          return (
            <div key={st}><b className="inline-block w-12 text-gray-500">{st}차</b>
              <span className="text-amber-700 font-semibold">대기</span>
              {names.length ? ` — ${lv}차 권한자: ${names.join(' · ')}${names.length > 1 ? ' (한 명만 처리)' : ''}` : ' — 지정된 권한자가 없습니다'}
              {st === 3 && roster[2].length > 0 && <span className="text-gray-400"> · 부재 시 2차 권한자가 전결</span>}
            </div>
          )
        }
        return <div key={st} className="text-gray-300"><b className="inline-block w-12">{st}차</b>-</div>
      })}
      {r.status !== 'requested' && (
        <div><b className="inline-block w-12 text-gray-500">결과</b>
          {progressLabel(r.status, r.steps, stepsReady)}{r.decided_by_name ? ` · ${r.decided_by_name}` : ''} · {kst(r.decided_at, true)}
          {r.decide_note && <span className="text-gray-500"> · 사유 &ldquo;{r.decide_note}&rdquo;</span>}
        </div>
      )}
    </div>
  )
}
