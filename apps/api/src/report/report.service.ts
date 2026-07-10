import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceEngineService, kstDateKey } from '../attendance-engine/attendance-engine.service';
import { LeavesService } from '../leave/leaves.service';
import { OvertimeService } from '../overtime/overtime.service';

/** 직원×월 요약 — 스냅샷과 동일 구조 (마감 전 = 계산, 마감 후 = 스냅샷. 기획서 1.4) */
export interface EmployeeMonthlySummary {
  employeeId: number;
  empNo: string;
  employeeName: string;
  departmentName: string | null;
  workdayCount: number;
  presentDays: number;
  absentDays: number;
  lateCount: number;
  lateMinutes: number;
  earlyLeaveCount: number;
  incompleteCount: number;
  leaveDays: number;
  workMinutes: number;
  overtimeMinutes: number;
}

export function monthRange(yearMonth: string): { from: Date; to: Date } {
  const [y, m] = yearMonth.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AttendanceEngineService,
    private readonly leaves: LeavesService,
    private readonly overtime: OvertimeService,
  ) {}

  /** 월 요약 — 마감(CLOSED)된 달은 스냅샷, 아니면 엔진 실시간 계산 */
  async monthlySummary(yearMonth: string): Promise<{ source: 'SNAPSHOT' | 'LIVE'; rows: EmployeeMonthlySummary[] }> {
    const closing = await this.prisma.monthlyClosing.findUnique({
      where: { yearMonth },
      include: { snapshots: { orderBy: { empNo: 'asc' } } },
    });
    if (closing?.status === 'CLOSED') {
      return {
        source: 'SNAPSHOT',
        rows: closing.snapshots.map((s) => ({
          employeeId: s.employeeId,
          empNo: s.empNo,
          employeeName: s.employeeName,
          departmentName: s.departmentName,
          workdayCount: s.workdayCount,
          presentDays: s.presentDays,
          absentDays: s.absentDays,
          lateCount: s.lateCount,
          lateMinutes: s.lateMinutes,
          earlyLeaveCount: s.earlyLeaveCount,
          incompleteCount: s.incompleteCount,
          leaveDays: s.leaveDays,
          workMinutes: s.workMinutes,
          overtimeMinutes: s.overtimeMinutes,
        })),
      };
    }
    return { source: 'LIVE', rows: await this.computeLive(yearMonth) };
  }

  /** 엔진 기반 실시간 월 집계 (마감 스냅샷 생성도 이 결과 사용 — 단일 판정 지점) */
  async computeLive(yearMonth: string): Promise<EmployeeMonthlySummary[]> {
    const { from, to } = monthRange(yearMonth);
    // 해당 월에 재직 기간이 겹치는 직원 (월중 퇴사자 포함)
    const employees = await this.prisma.employee.findMany({
      where: {
        hireDate: { lte: to },
        OR: [{ resignDate: null }, { resignDate: { gte: from } }],
      },
      include: { department: { select: { name: true } } },
      orderBy: { empNo: 'asc' },
    });

    const rows: EmployeeMonthlySummary[] = [];
    for (const emp of employees) {
      const leaveDates = await this.leaves.approvedDates(emp.id, from, to);
      const days = await this.engine.calculateRange(emp.id, from, to, leaveDates);
      const otMinutes = await this.overtime.approvedMinutes(emp.id, from, to);

      const workdays = days.filter((d) =>
        ['NORMAL', 'LATE', 'EARLY_LEAVE', 'LATE_EARLY', 'ABSENT', 'INCOMPLETE', 'LEAVE', 'WORKING', 'SCHEDULED'].includes(d.status),
      );
      rows.push({
        employeeId: emp.id,
        empNo: emp.empNo,
        employeeName: emp.name,
        departmentName: emp.department?.name ?? null,
        workdayCount: workdays.length,
        presentDays: days.filter((d) => ['NORMAL', 'LATE', 'EARLY_LEAVE', 'LATE_EARLY', 'WORKING'].includes(d.status)).length,
        absentDays: days.filter((d) => d.status === 'ABSENT').length,
        lateCount: days.filter((d) => d.lateMinutes > 0).length,
        lateMinutes: days.reduce((s, d) => s + d.lateMinutes, 0),
        earlyLeaveCount: days.filter((d) => d.earlyLeaveMinutes > 0).length,
        incompleteCount: days.filter((d) => d.status === 'INCOMPLETE').length,
        leaveDays: days.filter((d) => d.status === 'LEAVE').length,
        workMinutes: days.reduce((s, d) => s + d.workMinutes, 0),
        overtimeMinutes: otMinutes,
      });
    }
    return rows;
  }

  /** 연차 소멸 예정자 (기획서 4.11 — D-days 이내 잔여 보유) */
  async leaveExpiry(withinDays = 60) {
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const today = new Date(todayKey);
    const limit = new Date(today.getTime() + withinDays * 86400000);
    const grants = await this.prisma.leaveGrant.findMany({
      where: { status: 'ACTIVE', expireDate: { gte: today, lte: limit } },
      include: { usages: true, employee: { select: { empNo: true, name: true } } },
      orderBy: { expireDate: 'asc' },
    });
    return grants
      .map((g) => ({
        empNo: g.employee.empNo,
        employeeName: g.employee.name,
        grantDate: g.grantDate.toISOString().slice(0, 10),
        expireDate: g.expireDate.toISOString().slice(0, 10),
        remaining: g.days - g.usages.reduce((s, u) => s + u.days, 0),
        daysLeft: Math.round((g.expireDate.getTime() - today.getTime()) / 86400000),
      }))
      .filter((r) => r.remaining > 0);
  }

  /** 관리자 대시보드 (기획서 4.14) — 오늘 인원 현황 + 승인 대기 + 리스크 + 마감 상태 */
  async dashboard() {
    const todayKey = kstDateKey(new Date());
    const today = new Date(todayKey);
    const employees = await this.prisma.employee.findMany({ where: { status: 'ACTIVE' } });

    const counts = { present: 0, late: 0, notClockedIn: 0, leave: 0, dayoff: 0 };
    for (const emp of employees) {
      const leaveDates = await this.leaves.approvedDates(emp.id, today, today);
      const [day] = await this.engine.calculateRange(emp.id, today, today, leaveDates);
      if (!day) continue;
      switch (day.status) {
        case 'WORKING':
        case 'NORMAL':
        case 'EARLY_LEAVE':
          counts.present++;
          break;
        case 'LATE':
        case 'LATE_EARLY':
          counts.present++;
          counts.late++;
          break;
        case 'SCHEDULED':
          counts.notClockedIn++;
          break;
        case 'LEAVE':
          counts.leave++;
          break;
        case 'DAYOFF':
        case 'NO_SCHEDULE':
          counts.dayoff++;
          break;
        default:
          break;
      }
    }

    const pendingApprovals = await this.prisma.approval.groupBy({
      by: ['requestType'],
      where: { status: 'IN_PROGRESS' },
      _count: true,
    });
    const expiring = await this.leaveExpiry(60);
    const yearMonth = todayKey.slice(0, 7);
    const closing = await this.prisma.monthlyClosing.findUnique({ where: { yearMonth } });

    return {
      date: todayKey,
      headcount: employees.length,
      today: counts,
      pendingApprovals: Object.fromEntries(pendingApprovals.map((p) => [p.requestType, p._count])),
      leaveExpiringCount: expiring.length,
      closingStatus: closing?.status ?? 'OPEN',
    };
  }
}
