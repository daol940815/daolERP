import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PolicyResolverService } from '../policy/policy-resolver.service';
import { WorkPoliciesService } from '../policy/work-policies.service';
import { HolidaysService } from '../policy/holidays.service';
import { ClosingGuardService } from '../closing/closing-guard.service';

interface GenerateOptions {
  preserveManual?: boolean; // 재생성 시 개별 조정(MANUAL) 보존 (기획서 SCH-03)
}

export interface GenerateResult {
  employeeId: number;
  created: number;
  updated: number;
  skippedManual: number;
}

/** UTC 자정 기준 Date (일자만 다룸 — @db.Date) */
function dateOnly(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

@Injectable()
export class WorkSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: PolicyResolverService,
    private readonly workPolicies: WorkPoliciesService,
    private readonly holidays: HolidaysService,
    private readonly closingGuard: ClosingGuardService,
  ) {}

  list(params: { employeeId: number; from: string; to: string }) {
    return this.prisma.workSchedule.findMany({
      where: {
        employeeId: params.employeeId,
        date: { gte: new Date(params.from), lte: new Date(params.to) },
      },
      orderBy: { date: 'asc' },
      include: { shift: true },
    });
  }

  /**
   * 직원 1명의 특정 월 근무일정 생성/재생성.
   * 각 일자에 대해: 유효 근무정책 버전 조회 → 휴일/근무요일 판정 →
   *   근무일이면 예정 출퇴근 시각, 휴무면 isWorkday=false.
   * 재생성 시 MANUAL 조정분은 preserveManual 옵션에 따라 보존.
   */
  async generateForEmployeeMonth(
    employeeId: number,
    year: number,
    month: number, // 1~12
    opts: GenerateOptions = { preserveManual: true },
  ): Promise<GenerateResult> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');

    const resolved = await this.resolver.resolveWorkPolicy(employeeId);
    if (resolved.source === 'NONE' || !resolved.policyId) {
      throw new BadRequestException(
        `직원 ${employee.empNo} 에 적용할 근무정책이 없습니다 (개인/부서/전사 기본값 모두 미지정).`,
      );
    }
    const policyId = resolved.policyId;

    const result: GenerateResult = { employeeId, created: 0, updated: 0, skippedManual: 0 };
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = dateOnly(year, month - 1, day);
      // 재직 기간 밖(입사 전/퇴사 후)은 생성하지 않음
      if (employee.hireDate > date) continue;
      if (employee.resignDate && employee.resignDate < date) continue;

      const existing = await this.prisma.workSchedule.findUnique({
        where: { employeeId_date: { employeeId, date } },
      });
      if (existing && existing.source === 'MANUAL' && opts.preserveManual) {
        result.skippedManual++;
        continue;
      }

      const version = await this.workPolicies.getEffectiveVersion(policyId, date);
      const weekday = date.getUTCDay(); // 0=일..6=토
      const isHoliday = await this.holidays.isHoliday(date, employee.departmentId);
      const isWorkdayByPolicy = version ? (version.workDays as number[]).includes(weekday) : false;
      const isWorkday = isWorkdayByPolicy && !isHoliday;

      const data = {
        employeeId,
        date,
        isWorkday,
        // 근무일이고 고정/시차(시각 있음)면 예정 시각, 아니면 null (자율/휴무)
        plannedStart: isWorkday ? version?.startTime ?? null : null,
        plannedEnd: isWorkday ? version?.endTime ?? null : null,
        breakMinutes: isWorkday ? version?.breakMinutes ?? 0 : 0,
        source: 'AUTO' as const,
        workPolicyId: policyId,
      };

      if (existing) {
        await this.prisma.workSchedule.update({ where: { id: existing.id }, data });
        result.updated++;
      } else {
        await this.prisma.workSchedule.create({ data });
        result.created++;
      }
    }
    return result;
  }

  /** 전 재직 직원 대상 월 생성 (스케줄러 배치가 호출) */
  async generateAllForMonth(year: number, month: number): Promise<GenerateResult[]> {
    const employees = await this.prisma.employee.findMany({ where: { status: 'ACTIVE' } });
    const results: GenerateResult[] = [];
    for (const emp of employees) {
      try {
        results.push(await this.generateForEmployeeMonth(emp.id, year, month));
      } catch {
        // 정책 미지정 등으로 실패한 직원은 건너뛰되 결과에 0으로 표기
        results.push({ employeeId: emp.id, created: 0, updated: 0, skippedManual: 0 });
      }
    }
    return results;
  }

  /** 개별 일자 조정 — 휴무↔근무 전환·시간 변경. 사유 필수, MANUAL 로 표시 (기획서 SCH-02) */
  async adjust(
    input: {
      employeeId: number;
      date: string;
      isWorkday: boolean;
      plannedStart?: string | null;
      plannedEnd?: string | null;
      breakMinutes?: number;
      reason: string;
    },
    actor: { userId: number; ip?: string },
  ) {
    await this.closingGuard.assertOpen(input.date); // 마감된 월 기록 변경 차단 (CLS-01)
    const date = new Date(input.date);
    const before = await this.prisma.workSchedule.findUnique({
      where: { employeeId_date: { employeeId: input.employeeId, date } },
    });

    return this.prisma.$transaction(async (tx) => {
      const data = {
        employeeId: input.employeeId,
        date,
        isWorkday: input.isWorkday,
        plannedStart: input.isWorkday ? input.plannedStart ?? null : null,
        plannedEnd: input.isWorkday ? input.plannedEnd ?? null : null,
        breakMinutes: input.breakMinutes ?? before?.breakMinutes ?? 0,
        source: 'MANUAL' as const,
        adjustReason: input.reason,
      };
      const after = before
        ? await tx.workSchedule.update({ where: { id: before.id }, data })
        : await tx.workSchedule.create({ data });

      await this.audit.log(
        {
          targetType: 'work_schedule',
          targetId: after.id,
          action: before ? 'UPDATE' : 'CREATE',
          before,
          after,
          reason: input.reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return after;
    });
  }
}
