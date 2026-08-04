// 근태 공통 로직 — KST 날짜 처리 + 일별 상태 자동 판정
// 상태는 저장하지 않는다: 정책(attendance_policy) · 기록(attendance_records) ·
// 승인된 휴가(attendance_leaves)를 조합해 화면·집계 시점에 판정한다.
// 서버 라우트와 클라이언트 페이지가 함께 쓰는 순수 함수만 둔다.

export interface AttendancePolicy {
  work_start: string        // 'HH:MM' 또는 'HH:MM:SS'
  work_end: string
  late_grace_min: number
}

export interface AttendanceRecord {
  id: string
  employee_id: string
  work_date: string          // YYYY-MM-DD (KST)
  check_in_at: string | null
  check_out_at: string | null
  source: 'self' | 'admin'
  edited_by: string | null
  edit_note: string | null
}

export type LeaveType = 'annual' | 'half_am' | 'half_pm' | 'sick' | 'official' | 'other'
export type LeaveStatus = 'requested' | 'approved' | 'rejected' | 'canceled'

export interface AttendanceLeave {
  id: string
  employee_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  reason: string | null
  status: LeaveStatus
  decided_by: string | null
  decide_note: string | null
  created_at: string
}

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: '연차', half_am: '오전 반차', half_pm: '오후 반차',
  sick: '병가', official: '공가', other: '기타',
}
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  requested: '승인 대기', approved: '승인', rejected: '반려', canceled: '취소',
}
export const HALF_DAY_TYPES: LeaveType[] = ['half_am', 'half_pm']

// ── KST 날짜·시각 (Supabase timestamptz는 UTC — 한국은 DST가 없어 +9h 고정) ──
const KST_MS = 9 * 60 * 60 * 1000

export const kstToday = () => new Date(Date.now() + KST_MS).toISOString().slice(0, 10)
export const kstMonthNow = () => kstToday().slice(0, 7)
/** timestamptz ISO → KST 'HH:MM' */
export const kstTime = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + KST_MS).toISOString().slice(11, 16) : null
/** timestamptz ISO → KST 'YYYY-MM-DD' */
export const kstDate = (iso: string) =>
  new Date(new Date(iso).getTime() + KST_MS).toISOString().slice(0, 10)
/** KST 근무일 + 'HH:MM' → UTC ISO (관리자 보정 입력용) */
export const kstToUtcIso = (workDate: string, hhmm: string) =>
  new Date(new Date(`${workDate}T${hhmm}:00Z`).getTime() - KST_MS).toISOString()

/** 'YYYY-MM' → [시작일, 말일] */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}

/** 월 내 전체 날짜 목록 */
export function monthDates(month: string): string[] {
  const [start, end] = monthRange(month)
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0=일 … 6=토 */
export const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
export const isWeekend = (date: string) => [0, 6].includes(dayOfWeek(date))
export const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']

// ── 일별 상태 판정 ──────────────────────────────────────────
// weekend  주말 (근무일 아님 — 공휴일은 1단계 미반영, 설계 문서 참고)
// leave    종일 휴가 (연차·병가·공가·기타)
// present  정상 출근 (반차와 겹치면 halfLeave에 표시)
// late     지각 — 출근 기준 시각 + 유예를 지난 체크인. 오전 반차 날은 판정 제외
// missing_out 출근 체크만 있고 퇴근 체크 없음 (지난 날짜)
// absent   지난 근무일인데 기록·휴가 없음
// none     미래·오늘(기록 전)·입사 전 등 판정 대상 아님
export type DayStatusKind =
  | 'weekend' | 'leave' | 'present' | 'late' | 'missing_out' | 'absent' | 'none'

export interface DayStatus {
  kind: DayStatusKind
  record: AttendanceRecord | null
  leave: AttendanceLeave | null       // 그날을 덮는 승인된 휴가 (반차 포함)
  halfLeave: boolean                  // leave가 반차인지
}

export const DAY_STATUS_LABEL: Record<DayStatusKind, string> = {
  weekend: '주말', leave: '휴가', present: '출근', late: '지각',
  missing_out: '퇴근 미기록', absent: '미기록(결근)', none: '-',
}

const timeToMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function judgeDay(args: {
  date: string
  today: string                      // kstToday() — 판정 기준일
  record: AttendanceRecord | null
  leaves: AttendanceLeave[]          // 해당 직원의 승인된 휴가
  policy: AttendancePolicy
  hireDate?: string | null
}): DayStatus {
  const { date, today, record, leaves, policy, hireDate } = args
  const leave = leaves.find(l =>
    l.status === 'approved' && l.start_date <= date && date <= l.end_date) ?? null
  const halfLeave = !!leave && HALF_DAY_TYPES.includes(leave.leave_type)
  const base = { record, leave, halfLeave }

  if (isWeekend(date)) return { kind: 'weekend', ...base }
  if (hireDate && date < hireDate) return { kind: 'none', ...base }
  if (leave && !halfLeave) return { kind: 'leave', ...base }

  if (record?.check_in_at) {
    if (!record.check_out_at && date < today) return { kind: 'missing_out', ...base }
    // 오전 반차 날은 지각 판정에서 제외 (오후 출근이 정상)
    const inMin = timeToMin(kstTime(record.check_in_at)!)
    const lateFrom = timeToMin(policy.work_start.slice(0, 5)) + policy.late_grace_min
    const late = inMin > lateFrom && leave?.leave_type !== 'half_am'
    return { kind: late ? 'late' : 'present', ...base }
  }

  if (date < today) return { kind: 'absent', ...base }
  return { kind: 'none', ...base }
}

/** 휴가 일수 — 주말 제외 영업일 기준, 반차 0.5일. 월 경계로 자를 수 있다. */
export function leaveDays(l: AttendanceLeave, clampStart?: string, clampEnd?: string): number {
  const s = clampStart && clampStart > l.start_date ? clampStart : l.start_date
  const e = clampEnd && clampEnd < l.end_date ? clampEnd : l.end_date
  let days = 0
  for (let d = s; d <= e; d = addDays(d, 1)) if (!isWeekend(d)) days += 1
  return HALF_DAY_TYPES.includes(l.leave_type) ? days * 0.5 : days
}

// ── 월별 직원 집계 (관리자 화면·본인 화면 공용) ──────────────
export interface MonthSummary {
  workDays: number       // 판정 대상 근무일 수 (지난 근무일 기준)
  present: number        // 출근(정상)
  late: number
  missingOut: number
  absent: number
  leaveDays: number      // 승인 휴가 일수 (반차 0.5)
}

export function summarizeMonth(args: {
  month: string
  today: string
  records: AttendanceRecord[]        // 해당 직원의 그 달 기록
  leaves: AttendanceLeave[]          // 해당 직원의 승인 휴가 (기간 겹침 포함)
  policy: AttendancePolicy
  hireDate?: string | null
}): MonthSummary {
  const { month, today, records, leaves, policy, hireDate } = args
  const byDate = new Map(records.map(r => [r.work_date, r]))
  const [mStart, mEnd] = monthRange(month)
  const sum: MonthSummary = { workDays: 0, present: 0, late: 0, missingOut: 0, absent: 0, leaveDays: 0 }
  for (const date of monthDates(month)) {
    const st = judgeDay({ date, today, record: byDate.get(date) ?? null, leaves, policy, hireDate })
    if (st.kind === 'weekend' || st.kind === 'none') continue
    sum.workDays += 1
    if (st.kind === 'present') sum.present += 1
    if (st.kind === 'late') sum.late += 1
    if (st.kind === 'missing_out') sum.missingOut += 1
    if (st.kind === 'absent') sum.absent += 1
  }
  sum.leaveDays = leaves
    .filter(l => l.status === 'approved' && l.start_date <= mEnd && l.end_date >= mStart)
    .reduce((acc, l) => acc + leaveDays(l, mStart, mEnd), 0)
  return sum
}
