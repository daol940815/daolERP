import type { DayResult, DayStatus } from '@daolerp/shared';

/**
 * 일별 근태 판정 — 순수 함수 (기획서 5.2 엔진 계약).
 * DB 접근 없음. 같은 입력이면 항상 같은 출력.
 * 화면 조회·52시간 체크·마감 스냅샷이 모두 이 함수를 사용한다 (단일 판정 지점).
 */

export interface DayCalcInput {
  dateKey: string; // 'YYYY-MM-DD' (KST)
  /** 근무일정 — 없으면 NO_SCHEDULE */
  schedule: {
    isWorkday: boolean;
    plannedStart: string | null; // "HH:MM" (자율출퇴근은 null)
    plannedEnd: string | null;
    breakMinutes: number;
  } | null;
  /** 해당 일자 유효 정책 버전에서 온 판정 파라미터 */
  lateGraceMinutes: number;
  /** KST 자정 기준 분(minute) 오프셋으로 변환된 이벤트 (시간순 정렬) */
  events: { type: string; minutes: number }[];
  /** 승인된 휴가 여부 (M5 연결 — M4에서는 항상 false) */
  hasApprovedLeave: boolean;
  /** 계산 기준일 대비 관계 — 결근은 PAST에만, 미래는 SCHEDULED, 오늘 퇴근 전은 WORKING */
  dayRelation: 'PAST' | 'TODAY' | 'FUTURE';
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function calculateDay(input: DayCalcInput): DayResult {
  const anomalies: string[] = [];
  const clockIns = input.events.filter((e) => e.type === 'CLOCK_IN');
  const clockOuts = input.events.filter((e) => e.type === 'CLOCK_OUT');
  const outStarts = input.events.filter((e) => e.type === 'OUTING_START');
  const outEnds = input.events.filter((e) => e.type === 'OUTING_END');

  // 외출 시간 합산 (짝 순서대로. 짝 없으면 anomaly)
  let outingMinutes = 0;
  const pairs = Math.min(outStarts.length, outEnds.length);
  for (let i = 0; i < pairs; i++) {
    const diff = outEnds[i].minutes - outStarts[i].minutes;
    if (diff > 0) outingMinutes += diff;
  }
  if (outStarts.length !== outEnds.length) anomalies.push('외출/복귀 짝이 맞지 않습니다');

  const firstIn = clockIns.length > 0 ? clockIns[0].minutes : null;
  const lastOut = clockOuts.length > 0 ? clockOuts[clockOuts.length - 1].minutes : null;
  const hasAnyEvent = input.events.length > 0;

  // 근무시간 계산 (출퇴근 짝이 있을 때만)
  let workMinutes = 0;
  if (firstIn !== null && lastOut !== null && lastOut > firstIn) {
    workMinutes = Math.max(0, lastOut - firstIn - outingMinutes - (input.schedule?.breakMinutes ?? 0));
  }

  const base: Omit<DayResult, 'status'> = {
    dateKey: input.dateKey,
    workMinutes,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    anomalies,
  };

  // ── 판정 우선순위: 일정 없음 → 휴가 → 휴무 → 근무일 규칙 ──
  if (!input.schedule) return { ...base, status: 'NO_SCHEDULE' };
  if (input.hasApprovedLeave) return { ...base, status: 'LEAVE' };
  if (!input.schedule.isWorkday) return { ...base, status: 'DAYOFF' }; // 휴일근무 시간은 workMinutes 로 집계 (M6 OT)

  // 근무일
  if (!hasAnyEvent) {
    // 결근은 지나간 근무일에만 성립. 미래/오늘 미기록은 예정 (기획서 5.2)
    if (input.dayRelation === 'FUTURE' || input.dayRelation === 'TODAY')
      return { ...base, status: 'SCHEDULED' };
    return { ...base, status: 'ABSENT' };
  }
  if (firstIn === null || lastOut === null || lastOut <= firstIn) {
    // 오늘 출근 후 퇴근 전이면 정상적인 중간 상태 (근무 중)
    if (input.dayRelation === 'TODAY' && firstIn !== null && lastOut === null)
      return { ...base, status: 'WORKING' };
    anomalies.push('출근/퇴근 기록이 완전하지 않습니다');
    return { ...base, status: 'INCOMPLETE' };
  }

  // 자율출퇴근 (예정 시각 없음): 지각/조퇴 판정 없이 근무시간만 (기획서 5.2)
  if (!input.schedule.plannedStart || !input.schedule.plannedEnd) {
    return { ...base, status: 'NORMAL' };
  }

  const plannedStart = hhmmToMinutes(input.schedule.plannedStart);
  const plannedEnd = hhmmToMinutes(input.schedule.plannedEnd);

  const isLate = firstIn > plannedStart + input.lateGraceMinutes;
  const lateMinutes = isLate ? firstIn - plannedStart : 0;
  const isEarly = lastOut < plannedEnd;
  const earlyLeaveMinutes = isEarly ? plannedEnd - lastOut : 0;

  let status: DayStatus = 'NORMAL';
  if (isLate && isEarly) status = 'LATE_EARLY';
  else if (isLate) status = 'LATE';
  else if (isEarly) status = 'EARLY_LEAVE';

  return { ...base, status, lateMinutes, earlyLeaveMinutes };
}
