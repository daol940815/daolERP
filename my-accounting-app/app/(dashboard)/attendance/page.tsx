'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DAY_STATUS_LABEL, DOW_LABEL, LEAVE_TYPE_LABEL,
  dayOfWeek, judgeDay, kstMonthNow, kstTime, monthDates, summarizeMonth,
  type AttendanceLeave, type AttendancePolicy, type AttendanceRecord,
  type DayStatusKind, type MonthSummary,
} from '@/lib/attendance'

// 근태 현황 (전체 관리자) — 월별 직원 요약 + 일별 드릴다운·보정 + 휴가 승인 + 대상·정책 관리
// 상태는 저장값이 아니라 정책·기록·승인 휴가에서 자동 판정 (lib/attendance)

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
}
type LeaveRow = AttendanceLeave & { employee?: { name: string; team: string | null } | null }
type Filter = 'all' | 'late' | 'absent' | 'missing'

const STATUS_COLOR: Record<DayStatusKind, string> = {
  present: 'bg-green-100 text-green-700', late: 'bg-amber-100 text-amber-700',
  leave: 'bg-blue-100 text-blue-700', missing_out: 'bg-orange-100 text-orange-700',
  absent: 'bg-red-100 text-red-700', weekend: 'bg-gray-100 text-gray-400',
  none: 'bg-gray-50 text-gray-300',
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
    if (res2.ok) setPending((await res2.json()).leaves)
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
        policy: data.policy, hireDate: emp.hire_date,
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
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">근태 현황</h1>
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
        </div>
      </div>
      <p className="text-sm mt-1 text-gray-500">
        지각·미기록은 정책과 출퇴근 기록·승인 휴가로 자동 판정합니다. 카드를 누르면 해당 직원만 필터됩니다.
      </p>

      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

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
            {monthDates(data.month).filter(d => d <= data.today).map(date => {
              const record = records.find(r => r.work_date === date) ?? null
              const st = judgeDay({ date, today: data.today, record, leaves, policy: data.policy, hireDate: emp.hire_date })
              if (st.kind === 'weekend' && !record) return null
              const editing = adjust && adjust.empId === emp.id && adjust.date === date
              return (
                <div key={date} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="tabular-nums text-gray-500">{date.slice(5)} ({DOW_LABEL[dayOfWeek(date)]})</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_COLOR[st.kind]}`}>
                      {st.leave ? LEAVE_TYPE_LABEL[st.leave.leave_type] : DAY_STATUS_LABEL[st.kind]}
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
