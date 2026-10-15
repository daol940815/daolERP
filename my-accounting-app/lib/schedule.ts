// 스케줄 — 저장하지 않고 기존 ERP 데이터에서 파생하는 일정 (docs/hr-track.md)
//
// 원칙: 스케줄 전용 테이블을 만들지 않는다. 휴가·공휴일·아르바이트·대출은 원본을 읽어
// 화면에서 합치고, 세무 반복 마감은 법정 기한이라 코드 상수로 둔다. 원본 날짜가 바뀌면
// 일정도 따라 바뀐다.
//
// 서버 라우트와 화면이 함께 쓰는 순수 함수만 둔다 (lib/attendance.ts의 날짜 유틸 재사용).

import { addDays, isOffDate, monthRange, type HolidayMap } from '@/lib/attendance'

export type ScheduleKind =
  | 'holiday'        // 공휴일·회사 휴무 (배경)
  | 'leave'          // 승인된 휴가
  | 'leave_pending'  // 승인 대기 휴가 (흐리게 — 겹침 확인용)
  | 'parttime'       // 아르바이트 근무기간
  | 'loan'           // 대출 원리금 상환일
  // 아래 5개는 관리 규칙(schedule_rules)의 category 를 그대로 쓴다
  | 'payroll' | 'tax' | 'company' | 'meeting' | 'other'

export const KIND_LABEL: Record<ScheduleKind, string> = {
  holiday: '공휴일', leave: '휴가', leave_pending: '휴가(대기)',
  parttime: '아르바이트', loan: '대출 상환',
  payroll: '급여·지급', tax: '세무 마감', company: '회사 행사', meeting: '외근·회의', other: '기타',
}

/** 관리 탭에서 등록·수정하는 종류 (schedule_rules.category) */
export type RuleCategory = 'payroll' | 'tax' | 'company' | 'meeting' | 'other'
export const RULE_CATEGORIES: RuleCategory[] = ['payroll', 'tax', 'company', 'meeting', 'other']

export interface ScheduleEvent {
  kind: ScheduleKind
  date: string               // 표시 날짜 (주말·공휴일이면 다음 영업일로 옮긴 결과)
  endDate?: string           // 기간형(아르바이트·연차)일 때 종료일
  title: string
  who?: string | null        // 대상 직원
  amount?: number | null     // 자금 항목 금액
  note?: string | null       // 원래 기한 등 보조 설명
}

// ── 영업일 계산 ────────────────────────────────────────────
/** 주말·공휴일이면 다음 영업일로. 세무 기한·자동이체는 휴일이면 다음 날로 밀린다. */
export function nextBusinessDay(date: string, holidays: HolidayMap): string {
  let d = date
  for (let i = 0; i < 30 && isOffDate(d, holidays); i++) d = addDays(d, 1)
  return d
}

/** 주말·공휴일이면 직전 영업일로. 급여처럼 "늦어지면 안 되는" 일정에 쓴다. */
export function prevBusinessDay(date: string, holidays: HolidayMap): string {
  let d = date
  for (let i = 0; i < 30 && isOffDate(d, holidays); i++) d = addDays(d, -1)
  return d
}

export type HolidayShift = 'prev' | 'next' | 'none'
/** 휴일 처리 방향을 적용한다. 항목마다 방향이 다르다(세무=순연, 급여=앞당김). */
export function applyShift(date: string, shift: HolidayShift, holidays: HolidayMap): string {
  if (shift === 'prev') return prevBusinessDay(date, holidays)
  if (shift === 'next') return nextBusinessDay(date, holidays)
  return date
}

/** 'YYYY-MM' + 일자 → 그 달의 날짜. 말일을 넘기면 말일로 맞춘다(31 = 말일 규칙). */
export function dayInMonth(month: string, day: number): string {
  const [, mEnd] = monthRange(month)
  const last = Number(mEnd.slice(8, 10))
  const d = Math.min(Math.max(day, 1), last)
  return `${month}-${String(d).padStart(2, '0')}`
}

// ── 관리 규칙 (schedule_rules, 202) ────────────────────
// 급여일·법인카드 출금일·세무 마감·회사 행사·외근 등 ERP 원본에 자리가 없는 일정.
// 반복은 날짜를 저장하지 않고 여기서 그 달의 날짜를 계산한다.

export interface RuleRow {
  id: string
  title: string
  category: RuleCategory
  repeat_kind: 'monthly' | 'yearly' | 'once'
  repeat_day: number | null
  repeat_month: number | null
  on_date: string | null
  end_date: string | null
  holiday_shift: HolidayShift
  amount: number | null
  employee_id: string | null
  finance_only: boolean
  active: boolean
  memo: string | null
}

/** 규칙을 해당 월의 일정으로 펼친다. 휴일로 날짜가 옮겨지면 원래 날짜를 note에 남긴다. */
export function expandRules(
  rules: RuleRow[], month: string, holidays: HolidayMap,
  nameById?: Map<string, string>,
): ScheduleEvent[] {
  const [mStart, mEnd] = monthRange(month)
  const m = Number(month.slice(5, 7))
  const out: ScheduleEvent[] = []

  for (const r of rules) {
    if (!r.active) continue
    const who = r.employee_id ? (nameById?.get(r.employee_id) ?? null) : null
    const base = { kind: r.category, title: r.title, amount: r.amount, who }

    if (r.repeat_kind === 'once') {
      if (!r.on_date) continue
      const end = r.end_date ?? r.on_date
      if (end < mStart || r.on_date > mEnd) continue
      // 사람이 날짜를 정한 1회성 일정은 휴일이어도 옮기지 않는다
      out.push({ ...base, date: r.on_date, endDate: end, note: r.memo })
      continue
    }
    if (r.repeat_kind === 'yearly' && r.repeat_month !== m) continue
    if (!r.repeat_day) continue

    const due = dayInMonth(month, r.repeat_day)
    const shown = applyShift(due, r.holiday_shift, holidays)
    const moved = shown !== due
    out.push({
      ...base, date: shown,
      note: moved
        ? `원래 ${due.slice(5)} (휴일로 ${r.holiday_shift === 'prev' ? '앞당김' : '순연'})`
        : r.memo,
    })
  }
  return out
}

// ── 대출 원리금 상환 ───────────────────────────────────────
export interface LoanRow {
  id: string
  bank_name: string
  title: string
  monthly_principal: number
  monthly_interest: number
  payment_day: number | null
  status: string
  maturity_date: string | null
}

/** 상환일이 있는 진행 중 대출을 해당 월의 일정으로. 자동이체라 휴일이면 다음 영업일. */
export function loanPayments(loans: LoanRow[], month: string, holidays: HolidayMap): ScheduleEvent[] {
  const [mStart, mEnd] = monthRange(month)
  return loans
    .filter(l => l.status === 'active' && l.payment_day
      && !(l.maturity_date && l.maturity_date < mStart))
    .map(l => {
      const due = dayInMonth(month, l.payment_day!)
      const shown = nextBusinessDay(due, holidays)
      const amount = (l.monthly_principal ?? 0) + (l.monthly_interest ?? 0)
      return {
        kind: 'loan' as const,
        date: shown > mEnd ? mEnd : shown,
        title: `${l.bank_name} ${l.title}`,
        amount: amount > 0 ? amount : null,
        note: shown !== due ? `원래 ${due.slice(5)} (휴일로 순연)` : '월 원금+이자(참고)',
      }
    })
}

// ── 아르바이트 근무기간 ────────────────────────────────────
export interface PartTimeRow {
  id: string
  name: string
  work_start: string | null
  work_end: string | null
}

/** 근무기간이 그 달과 겹치는 아르바이트. 기간형이라 캘린더에서는 막대로 그린다. */
export function partTimePeriods(rows: PartTimeRow[], month: string): ScheduleEvent[] {
  const [mStart, mEnd] = monthRange(month)
  return rows
    .filter(r => r.work_start && (r.work_end ?? '9999-12-31') >= mStart && r.work_start <= mEnd)
    .map(r => ({
      kind: 'parttime' as const,
      date: r.work_start! < mStart ? mStart : r.work_start!,
      endDate: (r.work_end ?? mEnd) > mEnd ? mEnd : (r.work_end ?? mEnd),
      title: '아르바이트 근무',
      who: r.name,
      note: `${r.work_start} ~ ${r.work_end ?? '미정'}`,
    }))
}

// ── 날짜별로 펼치기 (월 캘린더 칸 채우기) ──────────────────
/** 기간형 일정을 날짜별로 나눠 담는다. 'YYYY-MM-DD' → 그날의 일정 목록 */
export function spreadByDate(events: ScheduleEvent[], month: string): Record<string, ScheduleEvent[]> {
  const [mStart, mEnd] = monthRange(month)
  const map: Record<string, ScheduleEvent[]> = {}
  for (const ev of events) {
    const end = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date
    for (let d = ev.date < mStart ? mStart : ev.date; d <= end && d <= mEnd; d = addDays(d, 1)) {
      ;(map[d] ??= []).push(ev)
    }
  }
  return map
}

/** 표시 우선순위 — 칸이 좁을 때 앞에 오는 순서 */
const ORDER: ScheduleKind[] = [
  'leave', 'leave_pending', 'meeting', 'parttime', 'payroll', 'loan', 'tax', 'company', 'other', 'holiday',
]
export const sortEvents = (a: ScheduleEvent, b: ScheduleEvent) =>
  ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
