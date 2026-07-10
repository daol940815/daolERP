import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../approval/approval.service';
import { AttendanceEngineService, kstDateKey } from '../attendance-engine/attendance-engine.service';
import { LeavesService } from '../leave/leaves.service';
import { NotificationService } from '../notification/notification.service';
import { ClosingGuardService } from '../closing/closing-guard.service';

/** "YYYY-MM-DD" + "HH:MM" (KST) → Date */
function kstDateTime(dateKey: string, hhmm: string): Date {
  return new Date(`${dateKey}T${hhmm}:00+09:00`);
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approval: ApprovalService,
    private readonly engine: AttendanceEngineService,
    private readonly leaves: LeavesService,
    private readonly notifications: NotificationService,
    private readonly closingGuard: ClosingGuardService,
  ) {}

  /**
   * 주 52시간 모니터링 배치 (기획서 OT-03) — 엔진 계산값 기준.
   * 임계(시간)는 system_settings 'attendance.weeklyHourAlertThreshold'.
   * 초과자: 본인 + 부서장 + HR 에게 알림 발행.
   */
  async runWeeklyHoursCheck(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'attendance.weeklyHourAlertThreshold' },
    });
    const thresholdHours = typeof setting?.value === 'number' ? setting.value : 48;

    // 이번 주 월요일 ~ 오늘 (KST)
    const todayKey = kstDateKey(new Date());
    const today = new Date(todayKey);
    const dow = (today.getUTCDay() + 6) % 7; // 월=0
    const monday = new Date(today.getTime() - dow * 86400000);

    const employees = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      include: { department: true },
    });
    const hrUsers = await this.prisma.user.findMany({
      where: { isActive: true, userRoles: { some: { role: { code: 'HR' } } } },
      select: { id: true },
    });

    let alerted = 0;
    for (const emp of employees) {
      const leaveDates = await this.leaves.approvedDates(emp.id, monday, today);
      const results = await this.engine.calculateRange(emp.id, monday, today, leaveDates);
      const totalMinutes = results.reduce((s, r) => s + r.workMinutes, 0);
      if (totalMinutes < thresholdHours * 60) continue;

      const hours = Math.round((totalMinutes / 60) * 10) / 10;
      const targets = [emp.id];
      if (emp.department?.headEmployeeId && emp.department.headEmployeeId !== emp.id)
        targets.push(emp.department.headEmployeeId);
      await this.notifications.publishToEmployees(targets, 'attendance.weekly-hours', {
        employeeName: emp.name,
        hours,
        threshold: thresholdHours,
      });
      await this.notifications.publish(
        hrUsers.map((u) => u.id),
        'attendance.weekly-hours',
        { employeeName: emp.name, hours, threshold: thresholdHours },
      );
      alerted++;
    }
    return alerted;
  }

  /** 출퇴근 체크 — 서버 시간 기준, 메타데이터 수집 (기획서 ATT-01/02) */
  async clock(
    employeeId: number,
    eventType: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    return this.prisma.attendanceEvent.create({
      data: {
        employeeId,
        eventType,
        occurredAt: new Date(),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  }

  /** 일자 기간의 이벤트 + 엔진 판정 결과 */
  async daily(employeeId: number, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    // 승인된 휴가 → 엔진 LEAVE 판정 입력 (기획서 5.2: 승인된 휴가는 결근 아님)
    const leaveDates = await this.leaves.approvedDates(employeeId, fromDate, toDate);
    const [results, events] = await Promise.all([
      this.engine.calculateRange(employeeId, fromDate, toDate, leaveDates),
      this.prisma.attendanceEvent.findMany({
        where: {
          employeeId,
          occurredAt: {
            gte: new Date(fromDate.getTime() - 24 * 3600 * 1000),
            lte: new Date(toDate.getTime() + 48 * 3600 * 1000),
          },
        },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);
    const eventsByDay = new Map<string, typeof events>();
    for (const e of events) {
      const key = kstDateKey(e.occurredAt);
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key)!.push(e);
    }
    return results.map((r) => ({ ...r, events: eventsByDay.get(r.dateKey) ?? [] }));
  }

  // ── 보정 신청 (기획서 ATT-03, 상태기계 5.3) ──

  /** 보정 신청 — 승인 인스턴스 동시 시작. 첨부파일 연결 */
  async requestCorrection(
    input: {
      employeeId: number;
      date: string;
      clockIn?: string;
      clockOut?: string;
      reason: string;
      attachmentIds?: number[];
    },
    actor: { userId: number; ip?: string },
  ) {
    if (!input.clockIn && !input.clockOut)
      throw new BadRequestException('보정할 출근 또는 퇴근 시각을 입력해야 합니다.');
    await this.closingGuard.assertOpen(input.date); // 마감된 월 기록 변경 차단 (CLS-01)

    return this.prisma.$transaction(async (tx) => {
      const correction = await tx.attendanceCorrection.create({
        data: {
          employeeId: input.employeeId,
          date: new Date(input.date),
          clockIn: input.clockIn ?? null,
          clockOut: input.clockOut ?? null,
          reason: input.reason,
          status: 'REQUESTED',
        },
      });
      await this.approval.start(
        {
          requestType: 'ATTENDANCE_CORRECTION',
          requestId: correction.id,
          applicantEmployeeId: input.employeeId,
        },
        tx,
      );
      if (input.attachmentIds?.length) {
        await tx.attachment.updateMany({
          where: { id: { in: input.attachmentIds }, uploadedBy: actor.userId, refId: null },
          data: { refType: 'attendance_correction', refId: correction.id },
        });
      }
      await this.audit.log(
        {
          targetType: 'attendance_correction',
          targetId: correction.id,
          action: 'CREATE',
          after: correction,
          reason: input.reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return correction;
    });
  }

  listCorrections(employeeId: number) {
    return this.prisma.attendanceCorrection.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** 신청자 취소 — REQUESTED 상태에서만 (기획서 5.3) */
  async cancelCorrection(correctionId: number, employeeId: number) {
    const correction = await this.prisma.attendanceCorrection.findUnique({
      where: { id: correctionId },
    });
    if (!correction) throw new NotFoundException('보정 신청을 찾을 수 없습니다.');
    if (correction.employeeId !== employeeId)
      throw new ForbiddenException('본인 신청만 취소할 수 있습니다.');
    if (correction.status !== 'REQUESTED')
      throw new BadRequestException(`취소할 수 없는 상태입니다: ${correction.status}`);

    return this.prisma.$transaction(async (tx) => {
      const approval = await tx.approval.findUnique({
        where: {
          requestType_requestId: {
            requestType: 'ATTENDANCE_CORRECTION',
            requestId: correctionId,
          },
        },
      });
      if (approval) await this.approval.cancel(approval.id, tx);
      return tx.attendanceCorrection.update({
        where: { id: correctionId },
        data: { status: 'CANCELLED' },
      });
    });
  }

  /**
   * 승인 훅: APPROVED → 보정 이벤트 생성 → APPLIED (기획서 5.3 —
   * 승인(판단)과 반영(이벤트 생성)을 분리, 반영 실패 시 APPROVED 로 남아 재처리 가능)
   */
  async applyCorrection(correctionId: number): Promise<void> {
    const correction = await this.prisma.attendanceCorrection.findUnique({
      where: { id: correctionId },
    });
    if (!correction || correction.status !== 'REQUESTED') return; // 멱등

    await this.prisma.attendanceCorrection.update({
      where: { id: correctionId },
      data: { status: 'APPROVED' },
    });

    const dateKey = correction.date.toISOString().slice(0, 10);
    await this.prisma.$transaction(async (tx) => {
      const toCreate: { eventType: string; occurredAt: Date }[] = [];
      if (correction.clockIn)
        toCreate.push({ eventType: 'CLOCK_IN', occurredAt: kstDateTime(dateKey, correction.clockIn) });
      if (correction.clockOut)
        toCreate.push({ eventType: 'CLOCK_OUT', occurredAt: kstDateTime(dateKey, correction.clockOut) });
      for (const e of toCreate) {
        await tx.attendanceEvent.create({
          data: {
            employeeId: correction.employeeId,
            eventType: e.eventType,
            occurredAt: e.occurredAt,
            isCorrection: true,
            correctionId: correction.id,
          },
        });
      }
      await tx.attendanceCorrection.update({
        where: { id: correctionId },
        data: { status: 'APPLIED', appliedAt: new Date() },
      });
      await this.audit.log(
        {
          targetType: 'attendance_correction',
          targetId: correctionId,
          action: 'UPDATE',
          before: { status: 'APPROVED' },
          after: { status: 'APPLIED', clockIn: correction.clockIn, clockOut: correction.clockOut },
          reason: '보정 승인 반영 (시스템)',
        },
        tx,
      );
    });
  }

  async rejectCorrection(correctionId: number): Promise<void> {
    const correction = await this.prisma.attendanceCorrection.findUnique({
      where: { id: correctionId },
    });
    if (!correction || correction.status !== 'REQUESTED') return; // 멱등
    await this.prisma.attendanceCorrection.update({
      where: { id: correctionId },
      data: { status: 'REJECTED' },
    });
  }
}
