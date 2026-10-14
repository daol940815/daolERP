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
  | 'tax'            // 세무 반복 마감

export const KIND_LABEL: Record<ScheduleKind, string> = {
  holiday: '공휴일', leave: '휴가', leave_pending: '휴가(대기)',
  parttime: '아르바이트', loan: '대출 상환', tax: '세무 마감',
}

/** 자금 항목 — 금액이 붙고 회계 권한자에게만 보인다 */
export const MONEY_KINDS: ScheduleKind[] = ['loan', 'tax']

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

/** 'YYYY-MM' + 일자 → 그 달의 날짜. 말일을 넘기면 말일로 맞춘다(31 = 말일 규칙). */
export function dayInMonth(month: string, day: number): string {
  const [, mEnd] = monthRange(month)
  const last = Number(mEnd.slice(8, 10))
  const d = Math.min(Math.max(day, 1), last)
  return `${month}-${String(d).padStart(2, '0')}`
}

// ── 세무 반복 마감 (법정 기한 — 회사별로 다르지 않아 상수로 둔다) ──
const TAX_MONTHLY: { day: number; title: string }[] = [
  { day: 10, title: '원천세 신고·납부' },
  { day: 10, title: '4대보험 납부' },
]
const TAX_YEARLY: { month: number; day: number; title: string }[] = [
  { month: 1,  day: 25, title: '부가세 확정신고 (2기)' },
  { month: 4,  day: 25, title: '부가세 예정신고 (1기)' },
  { month: 7,  day: 25, title: '부가세 확정신고 (1기)' },
  { month: 10, day: 25, title: '부가세 예정신고 (2기)' },
  { month: 3,  day: 31, title: '법인세 신고·납부' },
  { month: 8,  day: 31, title: '법인세 중간예납' },
]

/** 해당 월의 세무 마감. 기한이 휴일이면 다음 영업일에 표시하고 원래 기한을 note에 남긴다. */
export function taxDeadlines(month: string, holidays: HolidayMap): ScheduleEvent[] {
  const m = Number(month.slice(5, 7))
  const out: ScheduleEvent[] = []
  const push = (day: number, title: string) => {
    const due = dayInMonth(month, day)
    const shown = nextBusinessDay(due, holidays)
    out.push({
      kind: 'tax', date: shown, title,
      note: shown !== due ? `원래 기한 ${due.slice(5)} (휴일로 순연)` : null,
    })
  }
  for (const t of TAX_MONTHLY) push(t.day, t.title)
  for (const t of TAX_YEARLY) if (t.month === m) push(t.day, t.title)
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
const ORDER: ScheduleKind[] = ['leave', 'leave_pending', 'parttime', 'loan', 'tax', 'holiday']
export const sortEvents = (a: ScheduleEvent, b: ScheduleEvent) =>
  ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
