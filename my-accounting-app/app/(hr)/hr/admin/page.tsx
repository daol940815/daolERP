'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DAY_STATUS_LABEL, DOW_LABEL, LEAVE_TYPE_LABEL,
  dayOfWeek, isOffKind, judgeDay, kstMonthNow, kstTime, monthDates, summarizeMonth,
  type AttendanceLeave, type AttendancePolicy, type AttendanceRecord,
  type DayStatusKind, type HolidayMap, type MonthSummary,
} from '@/lib/attendance'

// 근태 현황 (직원 관리 모드, 전체 관리자) — 월별 직원 요약 + 일별 드릴다운·보정 +
// 휴가 승인 + 대상·정책 관리. 상태는 저장값이 아니라 정책·기록·승인 휴가에서 자동 판정

interface EmpRow {
  id: string
  name: string
  team: string | null
  position: string | null
  hire_date: string | null
  is_active: boolean
  attendance_target: boolean
  auth_user_id: string | null
}
interface MonthRes {
  month: string
  today: string
  policy: AttendancePolicy
  employees: EmpRow[]
  records: AttendanceRecord[]
  leaves: AttendanceLeave[]
  holidays: HolidayMap
  holidayYearCount: number
}
interface HolidayRow { holiday_date: string; name: string; source: 'public' | 'company' }
type LeaveRow = AttendanceLeave & { employee?: { name: string; team: string | null } | null }
type Filter = 'all' | 'late' | 'absent' | 'missing'

const STATUS_COLOR: Record<DayStatusKind, string> = {
  present: 'bg-green-100 text-green-700', late: 'bg-amber-100 text-amber-700',
  leave: 'bg-blue-100 text-blue-700', missing_out: 'bg-orange-100 text-orange-700',
  absent: 'bg-red-100 text-red-700', weekend: 'bg-gray-100 text-gray-400',
  holiday: 'bg-rose-100 text-rose-600', none: 'bg-gray-50 text-gray-300',
}

export default function AttendanceAdminPage() {
  const [data, setData] = useState<MonthRes | null>(null)
  const [month, setMonth] = useState(kstMonthNow())
  const [pending, setPending] = useState<LeaveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [openEmp, setOpenEmp] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<{ empId: string; date: string; in: string; out: string; note: string } | null>(null)
  const [showTargets, setShowTargets] = useState(false)
  const [policyEdit, setPolicyEdit] = useState<{ start: string; end: string; grace: string } | null>(null)
  // 공휴일 관리 (연도별)
  const [showHolidays, setShowHolidays] = useState(false)
  const [holidayRows, setHolidayRows] = useState<HolidayRow[]>([])
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '' })
  const [holidayYear, setHolidayYear] = useState(kstMonthNow().slice(0, 4))
  const [canSync, setCanSync] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const [res, res2] = await Promise.all([
      fetch(`/api/attendance/records?month=${month}&scope=all`),
      fetch('/api/attendance/leaves?scope=all&status=requested'),
    ])
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setLoading(false); return }
    setError(null); setData(json)
    const json2 = await res2.json().catch(() => ({}))
    if (res2.ok) setPending(json2.leaves)
    else setError(json2.error ?? '휴가 승인 대기 조회 실패')
    setLoading(false)
  }, [month])
  useEffect(() => { load() }, [load])

  const post = async (url: string, body: Record<string, string | number | boolean>) => {
    setBusy(true)
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); return false }
    return true
  }

  // 대상 직원별 월 요약
  const summaries = useMemo(() => {
    if (!data) return []
    const targets = data.employees.filter(e => e.attendance_target && e.is_active)
    return targets.map(emp => {
      const records = data.records.filter(r => r.employee_id === emp.id)
      const leaves = data.leaves.filter(l => l.employee_id === emp.id)
      const sum = summarizeMonth({
        month: data.month, today: data.today, records, leaves,
        policy: data.policy, hireDate: emp.hire_date, holidays: data.holidays,
      })
      return { emp, sum, records, leaves }
    })
  }, [data])

  const filtered = summaries.filter(({ sum }) =>
    filter === 'late' ? sum.late > 0
    : filter === 'absent' ? sum.absent > 0
    : filter === 'missing' ? sum.missingOut > 0
    : true)

  const totals = useMemo(() => summaries.reduce((a, { sum }) => ({
    late: a.late + (sum.late > 0 ? 1 : 0),
    absent: a.absent + (sum.absent > 0 ? 1 : 0),
    missing: a.missing + (sum.missingOut > 0 ? 1 : 0),
  }), { late: 0, absent: 0, missing: 0 }), [summaries])

  const saveAdjust = async () => {
    if (!adjust) return
    if (await post('/api/attendance/records', {
      action: 'adjust', employee_id: adjust.empId, work_date: adjust.date,
      check_in: adjust.in, check_out: adjust.out, edit_note: adjust.note,
    })) { flash('보정 완료'); setAdjust(null); load() }
  }

  const loadHolidays = useCallback(async () => {
    const res = await fetch(`/api/attendance/holidays?year=${holidayYear}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { flash(json.error ?? '공휴일 조회 실패'); return }
    setHolidayRows(json.holidays); setCanSync(!!json.canSync)
  }, [holidayYear])
  useEffect(() => { if (showHolidays) loadHolidays() }, [showHolidays, loadHolidays])
  // 공휴일 관리를 열면 보고 있는 달의 연도부터 보여준다
  useEffect(() => { if (showHolidays) setHolidayYear(month.slice(0, 4)) }, [showHolidays, month])

  const addHoliday = async () => {
    if (!holidayForm.date || !holidayForm.name.trim()) { flash('날짜와 휴일명을 입력하세요.'); return }
    if (await post('/api/attendance/holidays', {
      action: 'add', date: holidayForm.date, name: holidayForm.name.trim(), source: 'company',
    })) { flash('등록되었습니다.'); setHolidayForm({ date: '', name: '' }); loadHolidays(); load() }
  }

  // 공공데이터포털 특일정보 API에서 그 해 법정공휴일을 받아 교체 (회사 휴무는 보존)
  const syncHolidays = async () => {
    if (holidayRows.some(h => h.source === 'public') &&
      !window.confirm(`${holidayYear}년 법정공휴일을 공식 데이터로 다시 불러옵니다.\n기존 법정공휴일은 교체되고, 직접 등록한 회사 휴무는 그대로 유지됩니다.`)) return
    setSyncing(true)
    const res = await fetch('/api/attendance/holidays', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', year: holidayYear }),
    })
    const json = await res.json().catch(() => ({}))
    setSyncing(false)
    if (!res.ok) { flash(json.error ?? '불러오기 실패'); return }
    flash(`${holidayYear}년 공휴일 ${json.count}건을 불러왔습니다.`)
    loadHolidays(); load()
  }

  const deleteHoliday = async (date: string, name: string) => {
    if (!window.confirm(`${date} ${name}을(를) 휴일에서 제외할까요?\n해당 날짜가 근무일로 다시 판정됩니다.`)) return
    if (await post('/api/attendance/holidays', { action: 'delete', date })) {
      flash('삭제되었습니다.'); loadHolidays(); load()
    }
  }

  const toggleTarget = async (e: EmpRow) => {
    if (await post('/api/attendance/records', {
      action: 'set_target', employee_id: e.id, attendance_target: !e.attendance_target,
    })) { flash(`${e.name}: 근태 대상 ${e.attendance_target ? '제외' : '포함'}`); load() }
  }

  const savePolicy = async () => {
    if (!policyEdit) return
    if (await post('/api/attendance/records', {
      action: 'set_policy', work_start: policyEdit.start, work_end: policyEdit.end,
      late_grace_min: Number(policyEdit.grace),
    })) { flash('정책 저장 완료'); setPolicyEdit(null); load() }
  }

  const decide = async (id: string, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? (window.prompt('반려 사유를 입력하세요 (선택):') ?? '') : ''
    if (await post('/api/attendance/leaves', { action, id, note })) { flash('처리했습니다.'); load() }
  }

  const kpiCard = (label: string, value: string | number, f: Filter, tone = 'text-gray-900') => (
    <button onClick={() => setFilter(filter === f ? 'all' : f)}
      className={`bg-white border rounded-xl p-4 text-left transition-colors ${
        filter === f && f !== 'all' ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:border-gray-300'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
    </button>
  )

  const sumCell = (n: number, tone: string) =>
    <td className={`py-2 px-3 text-center tabular-nums ${n > 0 ? tone + ' font-semibold' : 'text-gray-300'}`}>{n}</td>

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">근태 현황</h1>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {data && !policyEdit && (
            <span>근무 {data.policy.work_start.slice(0, 5)}~{data.policy.work_end.slice(0, 5)}
              {data.policy.late_grace_min > 0 ? ` · 지각 유예 ${data.policy.late_grace_min}분` : ''}</span>
          )}
          {policyEdit ? (
            <span className="flex items-center gap-1">
              <input value={policyEdit.start} onChange={e => setPolicyEdit(p => p && { ...p, start: e.target.value })}
                placeholder="09:00" className="border border-gray-300 rounded px-1.5 py-1 w-16 text-xs" />
              ~
              <input value={policyEdit.end} onChange={e => setPolicyEdit(p => p && { ...p, end: e.target.value })}
                placeholder="18:00" className="border border-gray-300 rounded px-1.5 py-1 w-16 text-xs" />
              유예
              <input value={policyEdit.grace} onChange={e => setPolicyEdit(p => p && { ...p, grace: e.target.value })}
                className="border border-gray-300 rounded px-1.5 py-1 w-12 text-xs" />분
              <button onClick={savePolicy} disabled={busy} className="px-2 py-1 bg-slate-900 text-white rounded text-xs ml-1">저장</button>
              <button onClick={() => setPolicyEdit(null)} className="px-2 py-1 border border-gray-300 rounded text-xs">취소</button>
            </span>
          ) : (
            <button onClick={() => data && setPolicyEdit({
              start: data.policy.work_start.slice(0, 5), end: data.policy.work_end.slice(0, 5),
              grace: String(data.policy.late_grace_min),
            })} className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">정책 수정</button>
          )}
          <button onClick={() => setShowTargets(s => !s)}
            className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">
            {showTargets ? '대상 관리 닫기' : '근태 대상 관리'}
          </button>
          <button onClick={() => setShowHolidays(s => !s)}
            className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">
            {showHolidays ? '공휴일 관리 닫기' : '공휴일 관리'}
          </button>
        </div>
      </div>
      <p className="text-sm mt-1 text-gray-500">
        지각·미기록은 정책과 출퇴근 기록·승인 휴가로 자동 판정합니다. 주말과 공휴일은 근무일에서 제외됩니다.
        카드를 누르면 해당 직원만 필터됩니다.
      </p>

      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 공휴일 미등록 경고 — 등록 전까지 공휴일이 결근으로 판정된다 */}
      {data && data.holidayYearCount === 0 && (
        <div className="my-3 px-4 py-3 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg flex items-center gap-3 flex-wrap">
          <span>
            <b>{month.slice(0, 4)}년 공휴일이 등록되지 않았습니다.</b> 등록 전까지 이 해의 공휴일은
            근무일로 계산되어 미기록(결근)으로 표시됩니다.
          </span>
          <button onClick={() => setShowHolidays(true)}
            className="ml-auto px-3 py-1.5 bg-amber-700 text-white rounded-lg text-xs font-medium hover:bg-amber-800">
            공휴일 등록하기
          </button>
        </div>
      )}

      {/* 근태 대상 관리 */}
      {showTargets && data && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 my-4">
          <p className="text-xs text-gray-500 mb-2">
            근태 대상 여부를 직원별로 지정합니다. 로그인 계정이 없는 직원(거래처 엑셀로 등록된 상담자 등)은
            기본으로 제외되어 있습니다 — 필요 시 여기서 포함하세요.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
            {data.employees.filter(e => e.is_active).map(e => (
              <label key={e.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={e.attendance_target} disabled={busy} onChange={() => toggleTarget(e)} />
                <span className={e.attendance_target ? '' : 'text-gray-400'}>
                  {e.name}
                  <span className="text-[11px] text-gray-400 ml-1">
                    {e.team ?? ''}{!e.auth_user_id ? ' · 계정없음' : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 공휴일 관리 */}
      {showHolidays && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 my-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <select value={holidayYear} onChange={e => setHolidayYear(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
              {Array.from({ length: 5 }, (_, i) => String(Number(kstMonthNow().slice(0, 4)) - 1 + i)).map(y => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">{holidayRows.length}건 등록됨</span>
            {canSync ? (
              <button onClick={syncHolidays} disabled={syncing || busy}
                className="ml-auto px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                {syncing ? '불러오는 중...' : `${holidayYear}년 공휴일 불러오기`}
              </button>
            ) : (
              <span className="ml-auto text-[11px] text-gray-400">
                공휴일 API 키(DATA_GO_KR_SERVICE_KEY) 미설정 — 아래에서 직접 등록
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-2">
            여기 있는 날짜는 근무일에서 제외되어 결근·지각으로 판정되지 않습니다.
            불러오기는 공공데이터포털(한국천문연구원) 공식 데이터로 법정공휴일을 교체하며,
            직접 등록한 회사 휴무는 유지됩니다.
          </p>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <input type="date" value={holidayForm.date}
              onChange={e => setHolidayForm(f => ({ ...f, date: e.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
            <input value={holidayForm.name} placeholder="휴일명 (예: 창립기념일)"
              onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52" />
            <button onClick={addHoliday} disabled={busy}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              추가
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
            {holidayRows.map(h => (
              <div key={h.holiday_date} className="flex items-center gap-2 text-sm border border-gray-100 rounded-lg px-2.5 py-1.5">
                <span className="tabular-nums text-gray-500 text-xs">
                  {h.holiday_date.slice(5)} ({DOW_LABEL[dayOfWeek(h.holiday_date)]})
                </span>
                <span className="font-medium">{h.name}</span>
                {h.source === 'company' && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500">회사 휴무</span>
                )}
                <button onClick={() => deleteHoliday(h.holiday_date, h.name)} disabled={busy}
                  className="ml-auto text-xs text-gray-400 hover:text-red-600">삭제</button>
              </div>
            ))}
            {!holidayRows.length && (
              <p className="text-sm text-gray-400 py-4">
                {holidayYear}년에 등록된 휴일이 없습니다.
                {canSync ? ' 위의 불러오기 버튼을 누르세요.' : ' 아래에서 직접 등록하세요.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* KPI (클릭 = 필터) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-4">
        {kpiCard('근태 대상 인원', summaries.length, 'all')}
        {kpiCard('지각 발생 (인원)', totals.late, 'late', 'text-amber-600')}
        {kpiCard('미기록·결근 발생 (인원)', totals.absent, 'absent', 'text-red-600')}
        {kpiCard('퇴근 미기록 발생 (인원)', totals.missing, 'missing', 'text-orange-600')}
      </div>

      {/* 휴가 승인 대기 */}
      {pending.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-4 mb-4">
          <h2 className="font-bold text-gray-900">휴가 승인 대기 <span className="text-sm text-amber-600">{pending.length}건</span></h2>
          <table className="w-full text-sm mt-2">
            <tbody>
              {pending.map(l => (
                <tr key={l.id} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 font-semibold">{l.employee?.name ?? '-'}</td>
                  <td className="py-1.5 px-3 font-medium">{LEAVE_TYPE_LABEL[l.leave_type]}</td>
                  <td className="py-1.5 px-3 tabular-nums text-xs">
                    {l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''}
                  </td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{l.reason ?? ''}</td>
                  <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                    <button onClick={() => decide(l.id, 'approve')} disabled={busy}
                      className="text-xs px-2.5 py-1 bg-slate-900 text-white rounded mr-1 hover:bg-slate-700">승인</button>
                    <button onClick={() => decide(l.id, 'reject')} disabled={busy}
                      className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50">반려</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 직원별 월 요약 (행 클릭 = 일별 드릴다운) */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">직원</th>
                <th className="py-2 px-3 text-center font-medium">근무일</th>
                <th className="py-2 px-3 text-center font-medium">출근</th>
                <th className="py-2 px-3 text-center font-medium">지각</th>
                <th className="py-2 px-3 text-center font-medium">미기록(결근)</th>
                <th className="py-2 px-3 text-center font-medium">퇴근 미기록</th>
                <th className="py-2 px-3 text-center font-medium">휴가(일)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ emp, sum, records, leaves }) => (
                <FragmentRow key={emp.id} emp={emp} sum={sum} records={records} leaves={leaves}
                  data={data!} open={openEmp === emp.id}
                  onToggle={() => setOpenEmp(o => o === emp.id ? null : emp.id)}
                  adjust={adjust} setAdjust={setAdjust} saveAdjust={saveAdjust} busy={busy}
                  sumCell={sumCell} />
              ))}
              {!filtered.length && (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                  {summaries.length ? '필터에 해당하는 직원이 없습니다.' : '근태 대상 직원이 없습니다. 근태 대상 관리에서 지정하세요.'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FragmentRow({ emp, sum, records, leaves, data, open, onToggle, adjust, setAdjust, saveAdjust, busy, sumCell }: {
  emp: EmpRow
  sum: MonthSummary
  records: AttendanceRecord[]
  leaves: AttendanceLeave[]
  data: MonthRes
  open: boolean
  onToggle: () => void
  adjust: { empId: string; date: string; in: string; out: string; note: string } | null
  setAdjust: (a: { empId: string; date: string; in: string; out: string; note: string } | null) => void
  saveAdjust: () => void
  busy: boolean
  sumCell: (n: number, tone: string) => React.ReactNode
}) {
  const inp = 'border border-gray-300 rounded px-1.5 py-1 text-xs'
  return (<>
    <tr onClick={onToggle} className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${open ? 'bg-slate-50' : ''}`}>
      <td className="py-2 px-3">
        <span className="font-semibold">{emp.name}</span>
        <span className="text-xs text-gray-400 ml-2">{[emp.team, emp.position].filter(Boolean).join(' · ')}</span>
      </td>
      <td className="py-2 px-3 text-center tabular-nums text-gray-500">{sum.workDays}</td>
      <td className="py-2 px-3 text-center tabular-nums">{sum.present}</td>
      {sumCell(sum.late, 'text-amber-600')}
      {sumCell(sum.absent, 'text-red-600')}
      {sumCell(sum.missingOut, 'text-orange-600')}
      <td className="py-2 px-3 text-center tabular-nums">{sum.leaveDays > 0 ? sum.leaveDays : <span className="text-gray-300">0</span>}</td>
    </tr>
    {open && (
      <tr className="border-b border-gray-100 bg-slate-50/60">
        <td colSpan={7} className="px-4 py-3">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5">
            {/* 지난 날짜 + 기록·승인 휴가가 있는 미래 날짜 (예정 휴가가 보이도록) */}
            {monthDates(data.month).filter(d =>
              d <= data.today ||
              records.some(r => r.work_date === d) ||
              leaves.some(l => l.start_date <= d && d <= l.end_date)
            ).map(date => {
              const record = records.find(r => r.work_date === date) ?? null
              const st = judgeDay({
                date, today: data.today, record, leaves,
                policy: data.policy, hireDate: emp.hire_date, holidays: data.holidays,
              })
              if (isOffKind(st.kind) && !record) return null
              const editing = adjust && adjust.empId === emp.id && adjust.date === date
              return (
                <div key={date} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="tabular-nums text-gray-500">{date.slice(5)} ({DOW_LABEL[dayOfWeek(date)]})</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_COLOR[st.kind]}`}>
                      {st.holidayName ?? (st.leave ? LEAVE_TYPE_LABEL[st.leave.leave_type] : DAY_STATUS_LABEL[st.kind])}
                    </span>
                    <button onClick={() => setAdjust(editing ? null : {
                      empId: emp.id, date,
                      in: kstTime(record?.check_in_at ?? null) ?? '',
                      out: kstTime(record?.check_out_at ?? null) ?? '', note: '',
                    })} className="ml-auto text-[10px] text-gray-400 hover:text-gray-700">보정</button>
                  </div>
                  {editing ? (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      <input value={adjust.in} placeholder="09:00" className={`${inp} w-14`}
                        onChange={e => setAdjust({ ...adjust, in: e.target.value })} />
                      ~
                      <input value={adjust.out} placeholder="18:00" className={`${inp} w-14`}
                        onChange={e => setAdjust({ ...adjust, out: e.target.value })} />
                      <input value={adjust.note} placeholder="사유 (필수)" className={`${inp} flex-1 min-w-[90px]`}
                        onChange={e => setAdjust({ ...adjust, note: e.target.value })} />
                      <button onClick={saveAdjust} disabled={busy}
                        className="px-2 py-1 bg-slate-900 text-white rounded text-[10px]">저장</button>
                    </div>
                  ) : (
                    <p className="mt-1 tabular-nums text-gray-700">
                      {kstTime(record?.check_in_at ?? null) ?? '-'} ~ {kstTime(record?.check_out_at ?? null) ?? '-'}
                      {record?.edit_note && <span className="text-gray-400 ml-1.5">보정: {record.edit_note}</span>}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </td>
      </tr>
    )}
  </>)
}
