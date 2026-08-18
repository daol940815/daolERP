'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DAY_STATUS_LABEL, DOW_LABEL, LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL,
  dayOfWeek, isOffKind, judgeDay, kstMonthNow, kstTime, monthDates, summarizeMonth,
  type AttendanceLeave, type AttendancePolicy, type AttendanceRecord,
  type DayStatusKind, type HolidayMap, type LeaveType,
} from '@/lib/attendance'

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
  absent: 'bg-red-100 text-red-700', weekend: 'bg-gray-100 text-gray-400',
  holiday: 'bg-rose-100 text-rose-600', none: 'bg-gray-50 text-gray-300',
}
const EMPTY_FORM = { leave_type: 'annual' as LeaveType, start_date: '', end_date: '', reason: '' }

export default function MyAttendancePage() {
  const [status, setStatus] = useState<StatusRes | null>(null)
  const [monthData, setMonthData] = useState<MonthRes | null>(null)
  const [month, setMonth] = useState(kstMonthNow())
  const [myLeaves, setMyLeaves] = useState<AttendanceLeave[]>([])
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
    setMyLeaves(json.leaves)
  }, [])

  useEffect(() => { loadStatus(); loadLeaves() }, [loadStatus, loadLeaves])
  useEffect(() => { loadMonth() }, [loadMonth])

  const post = async (url: string, body: Record<string, string>) => {
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
    if (await post('/api/attendance/leaves', { action: 'request', ...form, end_date: end })) {
      flash('휴가 신청 완료 (승인 대기)')
      setForm({ ...EMPTY_FORM }); setShowLeaveForm(false); loadLeaves()
    }
  }

  const cancelLeave = async (id: string) => {
    if (!window.confirm('이 휴가 신청을 취소할까요?')) return
    if (await post('/api/attendance/leaves', { action: 'cancel', id })) { flash('취소했습니다.'); loadLeaves() }
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
      <h1 className="text-xl font-bold text-gray-900">내 근태</h1>
      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 오늘 출퇴근 체크 */}
      {status && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mt-4 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-gray-400">{status.today} · 근무 {status.policy.work_start.slice(0, 5)}~{status.policy.work_end.slice(0, 5)}</p>
            <p className="text-lg font-bold mt-1">
              {todayHoliday && <span className="text-rose-600 mr-2">{todayHoliday}</span>}
              {status.todayLeave && <span className="text-blue-600 mr-2">{LEAVE_TYPE_LABEL[status.todayLeave.leave_type]}</span>}
              {inTime ? `출근 ${inTime}` : '출근 전'}
              {outTime && <span className="text-gray-500"> · 퇴근 {outTime}</span>}
            </p>
          </div>
          {status.isTarget ? (
            <div className="flex gap-2 ml-auto">
              <button onClick={() => check('check_in')} disabled={busy || !!inTime}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-700 disabled:opacity-40">
                출근 체크
              </button>
              <button onClick={() => check('check_out')} disabled={busy || !inTime}
                className="px-5 py-2.5 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 disabled:opacity-40">
                퇴근 체크
              </button>
            </div>
          ) : (
            <p className="ml-auto text-sm text-gray-400">근태 대상이 아닌 계정입니다.</p>
          )}
        </div>
      )}

      {/* 이번 달 요약 + 일별 기록 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-4 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-bold text-gray-900">월별 기록</h2>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          {summary && (
            <span className="text-xs text-gray-500 ml-auto">
              근무일 {summary.workDays} · 출근 {summary.present} · 지각 {summary.late} ·
              미기록 {summary.absent} · 휴가 {summary.leaveDays}일
            </span>
          )}
        </div>
        {monthData && monthData.holidayYearCount === 0 && (
          <p className="text-xs text-amber-700 mt-2">
            {month.slice(0, 4)}년 공휴일이 등록되지 않아 공휴일이 미기록으로 표시될 수 있습니다.
            관리자에게 공휴일 등록을 요청하세요.
          </p>
        )}
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
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
                  <tr key={date} className="border-b border-gray-50">
                    <td className="py-1.5 px-3 tabular-nums text-xs">
                      {date.slice(5)} ({DOW_LABEL[dayOfWeek(date)]})
                    </td>
                    <td className="py-1.5 px-3 tabular-nums">{kstTime(record?.check_in_at ?? null) ?? '-'}</td>
                    <td className="py-1.5 px-3 tabular-nums">{kstTime(record?.check_out_at ?? null) ?? '-'}</td>
                    <td className="py-1.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_COLOR[st.kind]}`}>
                        {st.holidayName ?? (st.leave ? LEAVE_TYPE_LABEL[st.leave.leave_type] : DAY_STATUS_LABEL[st.kind])}
                      </span>
                      {st.halfLeave && st.kind !== 'none' && st.record && (
                        <span className="ml-1 text-[11px] text-gray-400">{DAY_STATUS_LABEL[st.kind]}</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-xs text-gray-400">
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
      <div className="bg-white border border-gray-200 rounded-xl mt-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">휴가</h2>
          <button onClick={() => setShowLeaveForm(s => !s)}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700">
            {showLeaveForm ? '입력 닫기' : '+ 휴가 신청'}
          </button>
        </div>
        {showLeaveForm && (
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">종류</label>
              <select value={form.leave_type}
                onChange={e => setForm(f => ({ ...f, leave_type: e.target.value as LeaveType }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                {Object.entries(LEAVE_TYPE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">시작일</label>
              <input type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">종료일 (비우면 하루)</label>
              <input type="date" value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 font-semibold mb-1">사유 (선택)</label>
              <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <button onClick={requestLeave} disabled={busy}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              신청
            </button>
          </div>
        )}
        <table className="w-full text-sm mt-3">
          <tbody>
            {myLeaves.map(l => (
              <tr key={l.id} className="border-b border-gray-50">
                <td className="py-1.5 pr-3 font-medium">{LEAVE_TYPE_LABEL[l.leave_type]}</td>
                <td className="py-1.5 px-3 tabular-nums text-xs">
                  {l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''}
                </td>
                <td className="py-1.5 px-3 text-xs text-gray-500">{l.reason ?? ''}</td>
                <td className="py-1.5 px-3">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                    l.status === 'approved' ? 'bg-green-100 text-green-700'
                    : l.status === 'requested' ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-500'}`}>
                    {LEAVE_STATUS_LABEL[l.status]}
                  </span>
                  {l.decide_note && <span className="ml-2 text-[11px] text-gray-400">{l.decide_note}</span>}
                </td>
                <td className="py-1.5 pl-3 text-right">
                  {l.status === 'requested' && (
                    <button onClick={() => cancelLeave(l.id)} disabled={busy}
                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">취소</button>
                  )}
                </td>
              </tr>
            ))}
            {!myLeaves.length && (
              <tr><td className="py-6 text-center text-gray-400 text-sm">휴가 신청 이력이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
