import { Injectable } from '@nestjs/common';
import type { DayResult } from '@daolerp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkPoliciesService } from '../policy/work-policies.service';
import { calculateDay, type DayCalcInput } from './day-calculator';

const KST = 'Asia/Seoul';

/** Date → KST 'YYYY-MM-DD' */
export function kstDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: KST });
}

/** Date → KST 자정 기준 분 오프셋 */
function kstMinutes(d: Date): number {
  const [h, m] = d
    .toLocaleTimeString('en-GB', { hour12: false, timeZone: KST })
    .split(':')
    .map(Number);
  return h * 60 + m;
}

/**
 * 근태 계산 엔진 — 입력 조립 + 순수 계산(day-calculator) 호출 (기획서 5.2).
 * DB에 결과를 쓰지 않는다. 화면 조회·52시간 체크(M6)·마감 스냅샷(M7)이 공용.
 */
@Injectable()
export class AttendanceEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workPolicies: WorkPoliciesService,
  ) {}

  /**
   * 직원×기간 일별 근태 계산.
   * - 이벤트는 보정 우선: 보정 이벤트가 있는 날의 해당 유형(CLOCK_IN/OUT)은 보정본만 사용.
   * - 지각 유예는 일정의 생성 근거 정책의 해당 일자 유효 버전에서 조회 (버전 인지).
   * - 승인된 휴가는 leaveDates 로 주입 (M5 가 연결. M4 는 빈 셋).
   */
  async calculateRange(
    employeeId: number,
    from: Date,
    to: Date,
    leaveDates: Set<string> = new Set(),
  ): Promise<DayResult[]> {
    const [schedules, events] = await Promise.all([
      this.prisma.workSchedule.findMany({
        where: { employeeId, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.attendanceEvent.findMany({
        where: {
          employeeId,
          // KST 일자 경계를 넉넉히 포함 (전후 1일 버퍼 후 dateKey 로 정확 분류)
          occurredAt: {
            gte: new Date(from.getTime() - 24 * 3600 * 1000),
            lte: new Date(to.getTime() + 48 * 3600 * 1000),
          },
        },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);

    // 이벤트를 KST 일자별로 분류
    const eventsByDay = new Map<string, { type: string; minutes: number; isCorrection: boolean }[]>();
    for (const e of events) {
      const key = kstDateKey(e.occurredAt);
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key)!.push({
        type: e.eventType,
        minutes: kstMinutes(e.occurredAt),
        isCorrection: e.isCorrection,
      });
    }

    // 정책 버전 캐시 (policyId + dateKey → grace)
    const graceCache = new Map<string, number>();
    const graceFor = async (policyId: number | null, date: Date): Promise<number> => {
      if (!policyId) return 0;
      const key = `${policyId}:${kstDateKey(date)}`;
      if (!graceCache.has(key)) {
        const v = await this.workPolicies.getEffectiveVersion(policyId, date);
        graceCache.set(key, v?.lateGraceMinutes ?? 0);
      }
      return graceCache.get(key)!;
    };

    const results: DayResult[] = [];
    const todayKey = kstDateKey(new Date());
    // 기간 내 각 일자 순회 (스케줄 존재 여부와 무관하게 일자 단위)
    for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 24 * 3600 * 1000)) {
      const dateKey = t.toISOString().slice(0, 10); // 스케줄 date 는 UTC 자정 저장 → ISO 일자 = 일자 키
      const dayRelation = dateKey < todayKey ? 'PAST' : dateKey === todayKey ? 'TODAY' : 'FUTURE';
      const schedule = schedules.find((s) => s.date.toISOString().slice(0, 10) === dateKey) ?? null;

      const dayEvents = eventsByDay.get(dateKey) ?? [];
      // 보정 우선 규칙: 그 날 해당 유형의 보정 이벤트가 존재하면 그 유형은 보정본만 사용
      const effective = (['CLOCK_IN', 'CLOCK_OUT', 'OUTING_START', 'OUTING_END'] as const).flatMap(
        (type) => {
          const ofType = dayEvents.filter((e) => e.type === type);
          const corrections = ofType.filter((e) => e.isCorrection);
          return corrections.length > 0 ? corrections : ofType;
        },
      );
      effective.sort((a, b) => a.minutes - b.minutes);

      const input: DayCalcInput = {
        dateKey,
        schedule: schedule
          ? {
              isWorkday: schedule.isWorkday,
              plannedStart: schedule.plannedStart,
              plannedEnd: schedule.plannedEnd,
              breakMinutes: schedule.breakMinutes,
            }
          : null,
        lateGraceMinutes: schedule ? await graceFor(schedule.workPolicyId, schedule.date) : 0,
        events: effective.map(({ type, minutes }) => ({ type, minutes })),
        hasApprovedLeave: leaveDates.has(dateKey),
        dayRelation,
      };
      results.push(calculateDay(input));
    }
    return results;
  }
}
