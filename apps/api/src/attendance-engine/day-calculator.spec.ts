import { calculateDay, type DayCalcInput } from './day-calculator';

/** 판정 규칙 케이스 표 (기획서 5.2 — 테스트 우선 계약) */

const workday = (over: Partial<DayCalcInput> = {}): DayCalcInput => ({
  dateKey: '2026-07-08',
  schedule: { isWorkday: true, plannedStart: '09:00', plannedEnd: '18:00', breakMinutes: 60 },
  lateGraceMinutes: 0,
  events: [],
  hasApprovedLeave: false,
  dayRelation: 'PAST',
  ...over,
});

const m = (hhmm: string) => {
  const [h, mm] = hhmm.split(':').map(Number);
  return h * 60 + mm;
};

describe('calculateDay — 근태 판정 규칙', () => {
  test('정상: 정시 출근 + 정시 퇴근', () => {
    const r = calculateDay(workday({
      events: [
        { type: 'CLOCK_IN', minutes: m('08:55') },
        { type: 'CLOCK_OUT', minutes: m('18:05') },
      ],
    }));
    expect(r.status).toBe('NORMAL');
    expect(r.workMinutes).toBe(m('18:05') - m('08:55') - 60); // 휴게 60분 차감
    expect(r.lateMinutes).toBe(0);
  });

  test('지각: 예정 출근 이후 체크인 (지각분 = 예정 출근부터 계산)', () => {
    const r = calculateDay(workday({
      events: [
        { type: 'CLOCK_IN', minutes: m('09:20') },
        { type: 'CLOCK_OUT', minutes: m('18:00') },
      ],
    }));
    expect(r.status).toBe('LATE');
    expect(r.lateMinutes).toBe(20);
  });

  test('지각 유예: 유예시간 이내 체크인은 정상', () => {
    const r = calculateDay(workday({
      lateGraceMinutes: 10,
      events: [
        { type: 'CLOCK_IN', minutes: m('09:08') },
        { type: 'CLOCK_OUT', minutes: m('18:00') },
      ],
    }));
    expect(r.status).toBe('NORMAL');
  });

  test('조퇴: 예정 퇴근 이전 체크아웃', () => {
    const r = calculateDay(workday({
      events: [
        { type: 'CLOCK_IN', minutes: m('09:00') },
        { type: 'CLOCK_OUT', minutes: m('16:30') },
      ],
    }));
    expect(r.status).toBe('EARLY_LEAVE');
    expect(r.earlyLeaveMinutes).toBe(90);
  });

  test('지각+조퇴 복합', () => {
    const r = calculateDay(workday({
      events: [
        { type: 'CLOCK_IN', minutes: m('10:00') },
        { type: 'CLOCK_OUT', minutes: m('17:00') },
      ],
    }));
    expect(r.status).toBe('LATE_EARLY');
  });

  test('결근: 지나간 근무일인데 이벤트 없음', () => {
    expect(calculateDay(workday()).status).toBe('ABSENT');
  });

  test('미래 근무일은 결근이 아니라 예정(SCHEDULED)', () => {
    expect(calculateDay(workday({ dayRelation: 'FUTURE' })).status).toBe('SCHEDULED');
  });

  test('오늘 미기록은 예정, 출근 후 퇴근 전은 근무 중(WORKING)', () => {
    expect(calculateDay(workday({ dayRelation: 'TODAY' })).status).toBe('SCHEDULED');
    const r = calculateDay(workday({
      dayRelation: 'TODAY',
      events: [{ type: 'CLOCK_IN', minutes: m('09:00') }],
    }));
    expect(r.status).toBe('WORKING');
    expect(r.anomalies).toHaveLength(0);
  });

  test('짝 없는 기록: 출근만 있음 → INCOMPLETE + anomaly', () => {
    const r = calculateDay(workday({ events: [{ type: 'CLOCK_IN', minutes: m('09:00') }] }));
    expect(r.status).toBe('INCOMPLETE');
    expect(r.anomalies.length).toBeGreaterThan(0);
  });

  test('외출 차감: 근무시간에서 외출 시간 제외', () => {
    const r = calculateDay(workday({
      events: [
        { type: 'CLOCK_IN', minutes: m('09:00') },
        { type: 'OUTING_START', minutes: m('14:00') },
        { type: 'OUTING_END', minutes: m('15:00') },
        { type: 'CLOCK_OUT', minutes: m('18:00') },
      ],
    }));
    expect(r.status).toBe('NORMAL');
    expect(r.workMinutes).toBe(9 * 60 - 60 - 60); // 총 9h - 외출 1h - 휴게 1h
  });

  test('외출 짝 없음: anomaly 기록하되 판정은 진행', () => {
    const r = calculateDay(workday({
      events: [
        { type: 'CLOCK_IN', minutes: m('09:00') },
        { type: 'OUTING_START', minutes: m('14:00') },
        { type: 'CLOCK_OUT', minutes: m('18:00') },
      ],
    }));
    expect(r.anomalies).toContain('외출/복귀 짝이 맞지 않습니다');
    expect(r.status).toBe('NORMAL');
  });

  test('휴무일: DAYOFF, 이벤트 있으면 근무시간은 집계 (휴일근무 — M6 OT 대상)', () => {
    const r = calculateDay(workday({
      schedule: { isWorkday: false, plannedStart: null, plannedEnd: null, breakMinutes: 0 },
      events: [
        { type: 'CLOCK_IN', minutes: m('10:00') },
        { type: 'CLOCK_OUT', minutes: m('15:00') },
      ],
    }));
    expect(r.status).toBe('DAYOFF');
    expect(r.workMinutes).toBe(5 * 60);
  });

  test('승인된 휴가: LEAVE — 결근 아님 (기획서 5.2)', () => {
    const r = calculateDay(workday({ hasApprovedLeave: true }));
    expect(r.status).toBe('LEAVE');
  });

  test('자율출퇴근: 지각/조퇴 판정 없음, 근무시간만 집계', () => {
    const r = calculateDay(workday({
      schedule: { isWorkday: true, plannedStart: null, plannedEnd: null, breakMinutes: 60 },
      events: [
        { type: 'CLOCK_IN', minutes: m('11:00') },
        { type: 'CLOCK_OUT', minutes: m('20:00') },
      ],
    }));
    expect(r.status).toBe('NORMAL');
    expect(r.workMinutes).toBe(9 * 60 - 60);
    expect(r.lateMinutes).toBe(0);
  });

  test('근무일정 없음: NO_SCHEDULE', () => {
    expect(calculateDay(workday({ schedule: null })).status).toBe('NO_SCHEDULE');
  });
});
