// 연차 관리 규칙 (207, 2026-11-18 사용자 결정 — docs/hr-track.md "연차 관리")
//
// - 부여는 원장(attendance_leave_grants): 기본 · 보상 · 이월 · 조정. 취소된 부여는 세지 않는다.
// - 사용은 저장하지 않는다 — 승인된 휴가 중 차감 종류(연차 · 반차 · 병가)를 근무일 기준으로 센다.
// - 사용 순서: 기본(+조정) 먼저, 넘치면 보상(보상 + 이월), 그래도 넘치면 "초과"(막지 않음 — 경고만).
// - 남은 기본은 연말 소멸, 보상 잔여만 다음 해 이월(연초 정리에서 추천 → 인사·총무 확정).
// - 기본 연차 추천: 1월 1일 기준 근속 n년 → 15 + (n-1)/2 내림(최대 25). 1년 미만은 그해 돌아오는 입사 월마다 1일.
//   (2026 엑셀 값과 맞춘 규칙. 김재형 대표 2026년 19일은 엑셀 값 그대로 — 2027-01-01부터 이 규칙)
//
// 서버 라우트와 화면이 함께 쓰는 순수 함수만 둔다.

import {
  DEDUCT_LEAVE_TYPES, leaveDays,
  type AttendanceLeave, type HolidayMap,
} from '@/lib/attendance'

export type GrantKind = 'base' | 'comp' | 'carry' | 'adjust'
export type GrantSource = 'manual' | 'excel' | 'recommend'

export const GRANT_KIND_LABEL: Record<GrantKind, string> = {
  base: '기본', comp: '보상', carry: '이월', adjust: '조정',
}
export const GRANT_SOURCE_LABEL: Record<GrantSource, string> = {
  manual: '직접 등록', excel: '엑셀 이관', recommend: '연초 추천 확정',
}

export interface LeaveGrant {
  id: string
  employee_id: string
  year: number
  kind: GrantKind
  days: number
  grant_date: string
  reason: string | null
  source: GrantSource
  status: 'active' | 'canceled'
  created_at: string
  cancel_note?: string | null
  employee_name?: string | null
  created_by_name?: string | null
  canceled_by_name?: string | null
}

export interface LeaveBalance {
  base: number          // 기본 + 조정
  comp: number          // 보상 + 이월
  granted: number       // 부여 합계
  usedByMonth: number[] // 1~12월 (0-based index)
  used: number
  remainBase: number    // 남은 기본 (연말 소멸)
  remainComp: number    // 남은 보상 (다음 해 이월)
  remainTotal: number
  over: number          // 초과 사용 (보상까지 다 쓰고 넘친 만큼)
}

const r1 = (n: number) => Math.round(n * 10) / 10   // 0.5 단위 합산의 부동소수 오차 정리

export const isDeductible = (l: Pick<AttendanceLeave, 'leave_type' | 'status'>) =>
  l.status === 'approved' && DEDUCT_LEAVE_TYPES.includes(l.leave_type)

/** 한 직원 · 한 해의 잔여. grants 는 그 직원 · 그해 부여(취소 포함 가능 — 여기서 거른다), leaves 는 그 직원 휴가 */
export function computeBalance(args: {
  year: number
  grants: Pick<LeaveGrant, 'kind' | 'days' | 'status'>[]
  leaves: AttendanceLeave[]
  holidays?: HolidayMap
}): LeaveBalance {
  const { year, grants, leaves, holidays } = args
  const active = grants.filter(g => g.status === 'active')
  const base = r1(active.filter(g => g.kind === 'base' || g.kind === 'adjust').reduce((a, g) => a + Number(g.days), 0))
  const comp = r1(active.filter(g => g.kind === 'comp' || g.kind === 'carry').reduce((a, g) => a + Number(g.days), 0))
  const usedByMonth = Array.from({ length: 12 }, () => 0)
  for (const l of leaves) {
    if (!isDeductible(l)) continue
    for (let m = 0; m < 12; m++) {
      const mm = String(m + 1).padStart(2, '0')
      const mStart = `${year}-${mm}-01`
      const mEnd = `${year}-${mm}-${String(new Date(Date.UTC(year, m + 1, 0)).getUTCDate()).padStart(2, '0')}`
      if (l.end_date < mStart || l.start_date > mEnd) continue
      usedByMonth[m] += leaveDays(l, mStart, mEnd, holidays)
    }
  }
  for (let m = 0; m < 12; m++) usedByMonth[m] = r1(usedByMonth[m])
  const used = r1(usedByMonth.reduce((a, n) => a + n, 0))
  const remainBase = r1(Math.max(0, base - used))
  const fromComp = Math.max(0, used - base)
  const compLeft = r1(comp - fromComp)
  return {
    base, comp, granted: r1(base + comp), usedByMonth, used,
    remainBase, remainComp: Math.max(0, compLeft), remainTotal: r1(remainBase + Math.max(0, compLeft)),
    over: compLeft < 0 ? r1(-compLeft) : 0,
  }
}

/** 1월 1일 기준 완료 근속연수 */
export function serviceYears(hireDate: string, year: number): number {
  const [hy, hm, hd] = hireDate.split('-').map(Number)
  let n = year - hy
  if (hm > 1 || hd > 1) n -= 1           // 1월 1일 입사가 아니면 그해 기념일이 아직 안 지났다
  return Math.max(0, n)
}

/**
 * 그해 기본 연차 추천.
 * 근속 1년 이상: 15 + (n-1)/2 내림, 최대 25.
 * 1년 미만: 그해 안에 돌아오는 입사 월(1~11개월째)마다 1일 — 1년이 되는 날 이후 몫은 인사·총무가 조정으로 넣는다.
 */
export function recommendBase(hireDate: string | null, year: number): { days: number | null; years: number; rule: string } {
  if (!hireDate) return { days: null, years: 0, rule: '입사일 없음 — 직접 입력' }
  if (hireDate > `${year}-12-31`) return { days: null, years: 0, rule: '그해 입사 전' }
  const n = serviceYears(hireDate, year)
  if (n >= 1) {
    const days = Math.min(25, 15 + Math.floor((n - 1) / 2))
    return { days, years: n, rule: `근속 ${n}년 → 15 + ${Math.floor((n - 1) / 2)}` }
  }
  const [hy, hm, hd] = hireDate.split('-').map(Number)
  let count = 0
  for (let k = 1; k <= 11; k++) {
    const d = new Date(Date.UTC(hy, hm - 1 + k, hd))
    const iso = d.toISOString().slice(0, 10)
    if (iso >= `${year}-01-01` && iso <= `${year}-12-31`) count++
  }
  return { days: count, years: 0, rule: `1년 미만 — 그해 입사 월 ${count}번 × 1일` }
}

/** 0.5 단위 일수 검사 */
export const isHalfStep = (n: number) => Number.isFinite(n) && Math.round(n * 2) === n * 2
