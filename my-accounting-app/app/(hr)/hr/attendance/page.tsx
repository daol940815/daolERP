'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DAY_STATUS_LABEL, DOW_LABEL, LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL, REQUEST_LEAVE_TYPES,
  dayOfWeek, isOffKind, judgeDay, kstMonthNow, kstTime, leaveDays, leavePeriodText, monthDates, summarizeMonth,
  type AttendanceLeave, type AttendancePolicy, type AttendanceRecord,
  type DayStatusKind, type HolidayMap, type LeaveType,
} from '@/lib/attendance'
import { emptyRoster, type ApproveLevel, type ApproverRoster, type LeaveStep } from '@/lib/leave-approval'
import LeaveSteps from '@/components/hr/LeaveSteps'

import { btnCls, fieldBox } from '@/components/ui/kit'
// 내 근태 (직원 관리 모드) — 출퇴근 체크 + 월별 내 기록 + 휴가 신청
// 휴가 승인은 상단 "휴가 승인" 메뉴 (중간 관리자·전체 관리자)

interface StatusRes {
  today: string
  policy: AttendancePolicy
  isTarget: boolean
  record: AttendanceRecord | null
  todayLeave: AttendanceLeave | null
}
interface MonthRes {
  month: string
  today: string
  policy: AttendancePolicy
  records: AttendanceRecord[]
  leaves: AttendanceLeave[]
  holidays: HolidayMap
  holidayYearCount: number
}

const STATUS_COLOR: Record<DayStatusKind, string> = {
  present: 'bg-green-100 text-green-700', late: 'bg-amber-100 text-amber-700',
  leave: 'bg-blue-100 text-blue-700', missing_out: 'bg-orange-100 text-orange-700',
  absent: 'bg-red-100 text-red-700', weekend: 'bg-slate-100 text-slate-500',
  holiday: 'bg-rose-100 text-rose-600', none: 'bg-slate-50 text-slate-400',
}
const EMPTY_FORM = { leave_type: 'annual' as LeaveType, start_date: '', end_date: '', reason: '' }
const EMPTY_SKIP = { s1: false, s2: false, note: '' }   // 신청자 전결 (1 · 2차, 2026-11-04)
type MyLeave = AttendanceLeave & {
  decided_by_name?: string | null; decided_at?: string | null
  days?: number                    // 근무일 기준 일수 (주말·공휴일 제외, 반차 0.5) — 서버 계산
  steps?: LeaveStep[]              // 3단계 결재 이력 (204)
  // 승인된 휴가 취소 요청 (208)
  cancel_request_status?: 'pending' | 'rejected' | 'done' | null
  cancel_request_note?: string | null
  cancel_request_reply?: string | null
  actions?: { cancel_request?: boolean; cancel_request_withdraw?: boolean }
}
const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 10).replace('-', '/') : ''

export default function MyAttendancePage() {
  const [status, setStatus] = useState<StatusRes | null>(null)
  const [monthData, setMonthData] = useState<MonthRes | null>(null)
  const [month, setMonth] = useState(kstMonthNow())
  const [myLeaves, setMyLeaves] = useState<MyLeave[]>([])
  const [leaveHolidays, setLeaveHolidays] = useState<HolidayMap>({})   // 신청 양식 일수 미리보기용
  // 내 연차 잔여 (207) — 연차 대상(그해 부여 있음)일 때만 양식에 보여준다
  const [myBal, setMyBal] = useState<{ remainBase: number; remainComp: number; remainTotal: number; over: number } | null>(null)
  const [approval, setApproval] = useState<{ ready: boolean; myLevel: ApproveLevel | null; roster: ApproverRoster }>(
    { ready: false, myLevel: null, roster: emptyRoster() })
  const [skip, setSkip] = useState({ ...EMPTY_SKIP })
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/attendance/status')
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); return }
    setError(null); setStatus(json)
  }, [])

  const loadMonth = useCallback(async () => {
    const res = await fetch(`/api/attendance/records?month=${month}&scope=self`)
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '월별 기록 조회 실패'); return }
    setMonthData(json)
  }, [month])

  const loadLeaves = useCallback(async () => {
    const res = await fetch('/api/attendance/leaves?scope=self')
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '휴가 조회 실패'); return }
    setMyLeaves(json.leaves); setLeaveHolidays(json.holidays ?? {})
    setApproval({ ready: !!json.stepsReady, myLevel: json.myLevel ?? null, roster: json.roster ?? emptyRoster() })
  }, [])

  const loadMyBal = useCallback(async () => {
    const res = await fetch('/api/attendance/my-balance')
    const json = await res.json().catch(() => ({}))
    setMyBal(res.ok && json.ready && json.managed ? json.balance : null)
  }, [])
  useEffect(() => { loadStatus(); loadLeaves(); loadMyBal() }, [loadStatus, loadLeaves, loadMyBal])
  useEffect(() => { loadMonth() }, [loadMonth])

  const post = async (url: string, body: Record<string, unknown>) => {
    setBusy(true)
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); return false }
    return true
  }

  const check = async (action: 'check_in' | 'check_out') => {
    if (action === 'check_out' && status?.record?.check_out_at &&
      !window.confirm('이미 퇴근 체크가 있습니다. 지금 시각으로 갱신할까요?')) return
    if (await post('/api/attendance/status', { action })) {
      flash(action === 'check_in' ? '출근 체크 완료' : '퇴근 체크 완료')
      loadStatus(); loadMonth()
    }
  }

  const requestLeave = async () => {
    if (!form.start_date) { flash('시작일을 입력하세요.'); return }
    const end = form.end_date || form.start_date
    const skipSteps = [skip.s1 && 1, skip.s2 && 2].filter((n): n is number => !!n)
      .filter(n => n > (approval.myLevel ?? 0))
    if (skipSteps.length && !skip.note.trim()) { flash('전결할 때는 전결 사유를 입력하세요.'); return }
    if (await post('/api/attendance/leaves', {
      action: 'request', ...form, end_date: end, skip_steps: skipSteps, skip_note: skip.note.trim(),
    })) {
      flash(approval.myLevel === 3 ? '휴가 신청 완료 (3차 결재 권한자 — 자동 승인)' : '휴가 신청 완료 (결재 진행 중)')
      setForm({ ...EMPTY_FORM }); setSkip({ ...EMPTY_SKIP }); setShowLeaveForm(false); loadLeaves()
    }
  }

  // 신청 전 미리보기 — 주말·공휴일을 뺀 근무일 일수 (서버도 같은 계산으로 0일 신청을 막는다)
  const formEnd = form.end_date || form.start_date
  const formDays = form.start_date && formEnd >= form.start_date
    ? leaveDays({ ...form, end_date: formEnd } as AttendanceLeave, undefined, undefined, leaveHolidays)
    : null
  const formSpan = form.start_date && formEnd >= form.start_date
    ? Math.round((Date.parse(formEnd) - Date.parse(form.start_date)) / 86400_000) + 1 : 0
  const formWorkDates = formDays != null    // 반차 배율 없이 센 근무일 수 — 빠진 날이 있는지 안내용
    ? leaveDays({ start_date: form.start_date, end_date: formEnd, leave_type: 'annual' } as AttendanceLeave,
      undefined, undefined, leaveHolidays)
    : 0

  const cancelLeave = async (id: string) => {
    if (!window.confirm('이 휴가 신청을 취소할까요?')) return
    if (await post('/api/attendance/leaves', { action: 'cancel', id })) { flash('취소했습니다.'); loadLeaves() }
  }
  // 승인된 휴가는 본인이 바로 취소할 수 없다 — 인사 · 총무에 취소 요청(208, 사유 필수)
  const requestCancel = async (id: string) => {
    const note = window.prompt('승인된 휴가의 취소를 인사 · 총무에 요청합니다. 취소 사유를 입력하세요 (필수):')
    if (note === null) return
    if (!note.trim()) { flash('취소 사유를 입력해야 합니다.'); return }
    if (await post('/api/attendance/leaves', { action: 'cancel_request', id, note: note.trim() })) {
      flash('취소를 요청했습니다. 인사 · 총무가 확인하면 휴가가 취소됩니다.'); loadLeaves()
    }
  }
  const withdrawCancelRequest = async (id: string) => {
    if (!window.confirm('취소 요청을 철회할까요? 휴가는 그대로 승인 상태로 남습니다.')) return
    if (await post('/api/attendance/leaves', { action: 'cancel_request_withdraw', id })) { flash('취소 요청을 철회했습니다.'); loadLeaves() }
  }

  const inTime = kstTime(status?.record?.check_in_at ?? null)
  const outTime = kstTime(status?.record?.check_out_at ?? null)
  const summary = monthData ? summarizeMonth({
    month: monthData.month, today: monthData.today,
    records: monthData.records, leaves: monthData.leaves, policy: monthData.policy,
    holidays: monthData.holidays,
  }) : null
  const todayHoliday = monthData?.holidays?.[monthData.today] ?? null

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">내 근태</h1>
      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 오늘 출퇴근 체크 */}
      {status && (
        <div className="bg-white border border-slate-300 rounded-xl p-5 mt-4 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-slate-500">{status.today} · 근무 {status.policy.work_start.slice(0, 5)}~{status.policy.work_end.slice(0, 5)}</p>
            <p className="text-lg font-bold mt-1">
              {todayHoliday && <span className="text-rose-600 mr-2">{todayHoliday}</span>}
              {status.todayLeave && <span className="text-blue-600 mr-2">{LEAVE_TYPE_LABEL[status.todayLeave.leave_type]}</span>}
              {inTime ? `출근 ${inTime}` : '출근 전'}
              {outTime && <span className="text-slate-600"> · 퇴근 {outTime}</span>}
            </p>
          </div>
          {status.isTarget ? (
            <div className="flex gap-2 ml-auto">
              <button onClick={() => check('check_in')} disabled={busy || !!inTime}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-700 disabled:opacity-40">
                출근 체크
              </button>
              <button onClick={() => check('check_out')} disabled={busy || !inTime}
                className="px-5 py-2.5 border border-slate-400 text-slate-800 rounded-lg text-sm font-semibold hover:bg-slate-50 disabled:opacity-40">
                퇴근 체크
              </button>
            </div>
          ) : (
            <p className="ml-auto text-sm text-slate-500">근태 대상이 아닌 계정입니다.</p>
          )}
        </div>
      )}

      {/* 이번 달 요약 + 일별 기록 */}
      <div className="bg-white border border-slate-300 rounded-xl mt-4 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-bold text-slate-900">월별 기록</h2>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-slate-400 rounded-lg px-2 py-1 text-sm" />
          {summary && (
            <span className="text-xs text-slate-600 ml-auto">
              근무일 {summary.workDays} · 출근 {summary.present} · 지각 {summary.late} ·
              미기록 {summary.absent} · 휴가 {summary.leaveDays}일
            </span>
          )}
        </div>
        {monthData && monthData.holidayYearCount === 0 && (
          <p className="text-xs text-amber-700 mt-2">
            {month.slice(0, 4)}년 공휴일이 등록되지 않아 공휴일이 미기록으로 표시될 수 있습니다.
            인사·총무 담당자에게 공휴일 등록을 요청하세요.
          </p>
        )}
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs border-b border-slate-300">
                <th className="py-2 px-3 text-left font-medium">날짜</th>
                <th className="py-2 px-3 text-left font-medium">출근</th>
                <th className="py-2 px-3 text-left font-medium">퇴근</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
                <th className="py-2 px-3 text-left font-medium">비고</th>
              </tr>
            </thead>
            <tbody>
              {/* 지난 날짜 + 기록·승인 휴가가 있는 미래 날짜 표시 (예정 휴가가 보이도록) */}
              {monthData && monthDates(monthData.month).filter(d =>
                d <= monthData.today ||
                monthData.records.some(r => r.work_date === d) ||
                monthData.leaves.some(l => l.start_date <= d && d <= l.end_date)
              ).reverse().map(date => {
                const record = monthData.records.find(r => r.work_date === date) ?? null
                const st = judgeDay({
                  date, today: monthData.today, record,
                  leaves: monthData.leaves, policy: monthData.policy, holidays: monthData.holidays,
                })
                if (isOffKind(st.kind) && !record) return null
                return (
                  <tr key={date} className="border-b border-slate-200">
                    <td className="py-1.5 px-3 tabular-nums text-xs">
                      {date.slice(5)} ({DOW_LABEL[dayOfWeek(date)]})
                    </td>
                    <td className="py-1.5 px-3 tabular-nums">{kstTime(record?.check_in_at ?? null) ?? '-'}</td>
                    <td className="py-1.5 px-3 tabular-nums">{kstTime(record?.check_out_at ?? null) ?? '-'}</td>
                    <td className="py-1.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[st.kind]}`}>
                        {st.holidayName ?? (st.leave ? LEAVE_TYPE_LABEL[st.leave.leave_type] : DAY_STATUS_LABEL[st.kind])}
                      </span>
                      {st.halfLeave && st.kind !== 'none' && st.record && (
                        <span className="ml-1 text-xs text-slate-500">{DAY_STATUS_LABEL[st.kind]}</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-xs text-slate-500">
                      {record?.source === 'admin' ? '관리자 입력' : record?.edit_note ? `보정: ${record.edit_note}` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 휴가 신청 */}
      <div className="bg-white border border-slate-300 rounded-xl mt-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">휴가</h2>
          <button onClick={() => setShowLeaveForm(s => !s)}
            className={btnCls('primary', 'sm')}>
            {showLeaveForm ? '입력 닫기' : '+ 휴가 신청'}
          </button>
        </div>
        {showLeaveForm && (
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">종류</label>
              <select value={form.leave_type}
                onChange={e => setForm(f => ({ ...f, leave_type: e.target.value as LeaveType }))}
                className={fieldBox()}>
                {REQUEST_LEAVE_TYPES.map(v => <option key={v} value={v}>{LEAVE_TYPE_LABEL[v]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">시작일</label>
              <input type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className={fieldBox()} />
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">종료일 (비우면 하루)</label>
              <input type="date" value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className={fieldBox()} />
            </div>
            <div>
              <label className="block text-xs text-slate-600 font-semibold mb-1">사유 (선택)</label>
              <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                className={fieldBox()} />
            </div>
            <button onClick={requestLeave} disabled={busy || formDays === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              신청
            </button>
            {formDays != null && (
              <p className={`col-span-full text-xs ${formDays === 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {formDays === 0
                  ? '선택한 기간에 근무일이 없습니다. 주말과 공휴일은 휴가 일수에서 제외됩니다.'
                  : <>근무일 <b className="tabular-nums">{formDays}일</b>
                    {formSpan > formWorkDates &&
                      <span className="text-slate-500"> (달력 {formSpan}일 중 주말 · 공휴일 제외)</span>}</>}
              </p>
            )}
            {myBal && (() => {
              // 차감 종류(연차 · 반차 · 병가)만 잔여에 영향 — 초과여도 막지 않고 경고만 (2026-11-18 결정)
              const deduct = ['annual', 'half_am', 'half_pm', 'sick'].includes(form.leave_type) ? (formDays ?? 0) : 0
              const left = Math.round((myBal.remainTotal - myBal.over) * 10) / 10
              const after = Math.round((left - deduct) * 10) / 10
              return (
                <p className="col-span-full text-xs text-slate-700">
                  내 연차 잔여 <b>기본 {myBal.remainBase} · 보상 {myBal.remainComp}</b>
                  {myBal.over > 0 && <span className="text-red-600 font-semibold"> (이미 초과 {myBal.over}일 사용 중)</span>}
                  {deduct > 0 && after < 0 && (
                    <span className="block text-amber-700 mt-0.5">
                      잔여보다 {Math.min(deduct, -after)}일 많습니다. 신청은 할 수 있고, 승인되면 초과 사용({-after}일)으로 표시됩니다.
                    </span>
                  )}
                  {deduct > 0 && after >= 0 && <span className="text-slate-500"> → 승인 시 잔여 {after}일</span>}
                </p>
              )
            })()}
            {approval.ready && <ApprovalLine approval={approval} skip={skip} setSkip={setSkip} />}
          </div>
        )}
        <table className="w-full text-sm mt-3">
          <tbody>
            {myLeaves.map(l => (
              <tr key={l.id} className="border-b border-slate-200">
                <td className="py-1.5 pr-3 font-medium">{LEAVE_TYPE_LABEL[l.leave_type]}</td>
                <td className="py-1.5 px-3 tabular-nums text-xs whitespace-nowrap">{leavePeriodText(l, l.days)}</td>
                <td className="py-1.5 px-3 text-xs text-slate-600">{l.reason ?? ''}</td>
                <td className="py-1.5 px-3">
                  <LeaveSteps steps={l.steps ?? []} status={l.status} roster={approval.roster}
                    applicantId={l.employee_id} decidedByName={l.decided_by_name} stepsReady={approval.ready} source={l.source} />
                </td>
                <td className="py-1.5 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    l.status === 'approved' ? 'bg-green-100 text-green-700'
                    : l.status === 'requested' ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-600'}`}>
                    {LEAVE_STATUS_LABEL[l.status]}
                  </span>
                  {l.status !== 'requested' && l.decided_by_name && (
                    <span className="ml-2 text-xs text-slate-600">{l.decided_by_name} · {fmtDay(l.decided_at)}</span>
                  )}
                  {l.decide_note && <span className="ml-2 text-xs text-slate-500">{l.decide_note}</span>}
                  {l.status === 'approved' && l.cancel_request_status === 'pending' && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800" title={l.cancel_request_note ?? ''}>취소 요청 중</span>
                  )}
                  {l.status === 'approved' && l.cancel_request_status === 'rejected' && (
                    <span className="ml-2 text-xs text-slate-600">취소 요청 반려{l.cancel_request_reply ? `: ${l.cancel_request_reply}` : ''}</span>
                  )}
                </td>
                <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                  {l.status === 'requested' && (
                    <button onClick={() => cancelLeave(l.id)} disabled={busy}
                      className="text-xs px-2 py-1 border border-slate-400 rounded hover:bg-slate-50">신청 취소</button>
                  )}
                  {l.actions?.cancel_request && (
                    <button onClick={() => requestCancel(l.id)} disabled={busy}
                      className="text-xs px-2 py-1 border border-slate-400 rounded hover:bg-slate-50">취소 요청</button>
                  )}
                  {l.actions?.cancel_request_withdraw && (
                    <button onClick={() => withdrawCancelRequest(l.id)} disabled={busy}
                      className="text-xs px-2 py-1 border border-slate-400 rounded hover:bg-slate-50">요청 철회</button>
                  )}
                </td>
              </tr>
            ))}
            {!myLeaves.length && (
              <tr><td className="py-6 text-center text-slate-500 text-sm">휴가 신청 이력이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 신청 양식의 결재선 — 단계별 권한자 · 본인 단계 자동 통과 · 1 · 2차 전결 선택 (2026-11-04 결정)
function ApprovalLine({ approval, skip, setSkip }: {
  approval: { myLevel: ApproveLevel | null; roster: ApproverRoster }
  skip: { s1: boolean; s2: boolean; note: string }
  setSkip: (f: (s: { s1: boolean; s2: boolean; note: string }) => { s1: boolean; s2: boolean; note: string }) => void
}) {
  const lv = approval.myLevel ?? 0
  const names = (l: ApproveLevel) => approval.roster[l].map(p => `${p.name}${p.position ? ` ${p.position}` : ''}`).join(' · ') || '지정된 권한자 없음'
  const anySkip = (skip.s1 && lv < 1) || (skip.s2 && lv < 2)
  const Row = ({ l }: { l: ApproveLevel }) => (
    <div className="flex items-center gap-3 py-1">
      <span className="w-8 text-xs font-bold text-slate-600">{l}차</span>
      <span className="w-48 text-xs text-slate-800 truncate">{l <= lv ? '본인' : names(l)}</span>
      {l <= lv ? <span className="text-xs text-slate-500">자동 통과</span>
        : l === 3 ? <span className="text-xs text-slate-500">신청자 전결 불가 — 부재 시 2차 권한자가 전결</span>
        : (
          <label className="text-xs text-slate-800 flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={l === 1 ? skip.s1 : skip.s2}
              onChange={e => setSkip(s => (l === 1 ? { ...s, s1: e.target.checked } : { ...s, s2: e.target.checked }))} />
            전결 (승인권자 부재)
          </label>
        )}
    </div>
  )
  return (
    <div className="col-span-full border border-slate-300 rounded-lg px-3 py-2">
      <div className="text-xs font-bold text-slate-600 mb-0.5">결재선</div>
      <Row l={1} /><Row l={2} /><Row l={3} />
      {lv === 3 && <p className="text-xs text-slate-600 mt-1">3차 결재 권한자 본인 신청은 신청 즉시 승인되고 마스터 계정에 알림이 갑니다.</p>}
      {anySkip && (
        <div className="mt-1.5">
          <label className="block text-xs text-slate-600 font-semibold mb-1">전결 사유 (필수)</label>
          <input value={skip.note} onChange={e => { const v = e.target.value; setSkip(s => ({ ...s, note: v })) }}
            placeholder="예: 팀장 출장"
            className={fieldBox()} />
          <p className="text-xs text-amber-700 mt-1">전결한 단계의 승인권자에게는 나중에 알림이 가고, 휴가 목록에 &ldquo;신청자 전결&rdquo;과 사유가 남습니다.</p>
        </div>
      )}
    </div>
  )
}
