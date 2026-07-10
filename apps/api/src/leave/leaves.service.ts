import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../approval/approval.service';
import { PolicyResolverService } from '../policy/policy-resolver.service';
import { WorkPoliciesService } from '../policy/work-policies.service';
import { HolidaysService } from '../policy/holidays.service';
import { NotificationService } from '../notification/notification.service';
import { ClosingGuardService } from '../closing/closing-guard.service';
import { addMonthsClamped, computeAccruals } from './accrual-calculator';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

interface LeavePolicyShape {
  id: number;
  grantBasis: string;
  expireMonths: number;
  minUnit: number;
  promotionDays: number[];
}

@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approval: ApprovalService,
    private readonly resolver: PolicyResolverService,
    private readonly workPolicies: WorkPoliciesService,
    private readonly holidays: HolidaysService,
    private readonly notifications: NotificationService,
    private readonly closingGuard: ClosingGuardService,
  ) {}

  // ── 잔여 계산 (저장하지 않음 — grants − usages. 기획서 8장) ──

  async balance(employeeId: number) {
    const [grants, pending] = await Promise.all([
      this.prisma.leaveGrant.findMany({
        where: { employeeId },
        include: { usages: true },
        orderBy: { expireDate: 'asc' },
      }),
      // 가차감: 승인 대기(취소 신청 중 포함) 연차차감 신청
      this.prisma.leaveRequest.aggregate({
        where: {
          employeeId,
          status: 'REQUESTED',
          leaveType: { deductsAnnual: true },
        },
        _sum: { days: true },
      }),
    ]);

    const detail = grants.map((g) => {
      const used = g.usages.reduce((s, u) => s + u.days, 0);
      const remaining = g.status === 'EXPIRED' ? 0 : g.days - used;
      return {
        id: g.id,
        grantDate: dayKey(g.grantDate),
        expireDate: dayKey(g.expireDate),
        days: g.days,
        used,
        remaining,
        status: g.status,
        reason: g.reason,
        expiredDays: g.expiredDays,
      };
    });

    const granted = detail.reduce((s, g) => s + g.days, 0);
    const used = detail.reduce((s, g) => s + g.used, 0);
    const expired = detail.reduce((s, g) => s + (g.expiredDays ?? 0), 0);
    const remaining = detail.filter((g) => g.status !== 'EXPIRED').reduce((s, g) => s + g.remaining, 0);
    const pendingDays = pending._sum.days ?? 0;

    return {
      summary: { granted, used, expired, remaining, pending: pendingDays, available: remaining - pendingDays },
      grants: detail,
    };
  }

  // ── 휴가 일수 산정 — 근무일정 기준, 휴무일 자동 제외 (기획서 LEV-01) ──

  private async workingDays(employeeId: number, start: Date, end: Date): Promise<number> {
    const schedules = await this.prisma.workSchedule.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
    });
    const byKey = new Map(schedules.map((s) => [dayKey(s.date), s.isWorkday]));

    // 일정이 없는 날은 정책(근무요일)+휴일로 판정 (일정 미생성 기간 신청 대비)
    const resolved = await this.resolver.resolveWorkPolicy(employeeId);
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

    let count = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const known = byKey.get(dayKey(d));
      if (known !== undefined) {
        if (known) count++;
        continue;
      }
      if (!resolved.policyId) continue;
      const version = await this.workPolicies.getEffectiveVersion(resolved.policyId, d);
      const isWorkday =
        !!version &&
        (version.workDays as number[]).includes(d.getUTCDay()) &&
        !(await this.holidays.isHoliday(d, emp.departmentId));
      if (isWorkday) count++;
    }
    return count;
  }

  // ── 신청 (기획서 LEV-01: 잔여 초과·기간 중복 차단) ──

  async request(
    input: {
      employeeId: number;
      leaveTypeCode: string;
      startDate: string;
      endDate: string;
      halfDay?: boolean;
      reason: string;
      attachmentIds?: number[];
    },
    actor: { userId: number; ip?: string },
  ) {
    const leaveType = await this.prisma.leaveType.findUnique({ where: { code: input.leaveTypeCode } });
    if (!leaveType || !leaveType.isActive)
      throw new BadRequestException('유효하지 않은 휴가 유형입니다.');

    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (end < start) throw new BadRequestException('종료일이 시작일보다 빠릅니다.');
    await this.closingGuard.assertOpen(input.startDate); // 마감된 월 기록 변경 차단 (CLS-01)
    if (input.halfDay && input.startDate !== input.endDate)
      throw new BadRequestException('반차는 하루 단위로만 신청할 수 있습니다.');
    if (input.halfDay && !leaveType.allowHalfDay)
      throw new BadRequestException('반차를 허용하지 않는 휴가 유형입니다.');
    if (leaveType.attachmentRule === 'REQUIRED' && !input.attachmentIds?.length)
      throw new BadRequestException(`${leaveType.name}은(는) 증빙 첨부가 필수입니다.`);

    // 기간 중복 차단
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: input.employeeId,
        status: { in: ['REQUESTED', 'APPROVED', 'CANCEL_REQUESTED'] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlap)
      throw new BadRequestException(
        `해당 기간에 이미 신청된 휴가가 있습니다 (${dayKey(overlap.startDate)}~${dayKey(overlap.endDate)}).`,
      );

    // 일수 산정 (휴무일 제외)
    let days = input.halfDay ? 0.5 : await this.workingDays(input.employeeId, start, end);
    if (days <= 0) throw new BadRequestException('신청 기간에 근무일이 없습니다.');

    // 잔여 검증 (연차 차감 유형만 — 가차감 포함)
    if (leaveType.deductsAnnual) {
      const { summary } = await this.balance(input.employeeId);
      if (summary.available < days)
        throw new BadRequestException(
          `잔여 연차가 부족합니다 (가용 ${summary.available}일 < 신청 ${days}일).`,
        );
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.create({
        data: {
          employeeId: input.employeeId,
          leaveTypeId: leaveType.id,
          startDate: start,
          endDate: end,
          halfDay: input.halfDay ?? false,
          days,
          reason: input.reason,
        },
      });
      await this.approval.start(
        { requestType: 'LEAVE', requestId: request.id, applicantEmployeeId: input.employeeId },
        tx,
      );
      if (input.attachmentIds?.length) {
        await tx.attachment.updateMany({
          where: { id: { in: input.attachmentIds }, uploadedBy: actor.userId, refId: null },
          data: { refType: 'leave_request', refId: request.id },
        });
      }
      await this.audit.log(
        {
          targetType: 'leave_request',
          targetId: request.id,
          action: 'CREATE',
          after: request,
          reason: input.reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return request;
    });
  }

  list(employeeId: number) {
    return this.prisma.leaveRequest.findMany({
      where: { employeeId },
      include: { leaveType: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── 취소 (기획서 5.3: 승인 전 자유 취소, 승인 후 시작일 전 취소 신청) ──

  async cancel(requestId: number, employeeId: number) {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('휴가 신청을 찾을 수 없습니다.');
    if (request.employeeId !== employeeId)
      throw new ForbiddenException('본인 신청만 취소할 수 있습니다.');

    if (request.status === 'REQUESTED') {
      return this.prisma.$transaction(async (tx) => {
        const approval = await tx.approval.findUnique({
          where: { requestType_requestId: { requestType: 'LEAVE', requestId } },
        });
        if (approval) await this.approval.cancel(approval.id, tx);
        return tx.leaveRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
      });
    }

    if (request.status === 'APPROVED') {
      const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      if (dayKey(request.startDate) <= todayKey)
        throw new BadRequestException('휴가 시작일 이후에는 취소할 수 없습니다. HR에 문의하세요.');
      return this.prisma.$transaction(async (tx) => {
        await this.approval.start(
          { requestType: 'LEAVE_CANCEL', requestId, applicantEmployeeId: employeeId },
          tx,
        );
        return tx.leaveRequest.update({
          where: { id: requestId },
          data: { status: 'CANCEL_REQUESTED' },
        });
      });
    }

    throw new BadRequestException(`취소할 수 없는 상태입니다: ${request.status}`);
  }

  // ── 승인 훅 (기획서 5.3: 차감은 승인 시점 확정) ──

  /** LEAVE 승인 → 선입선출(만료 임박 순) 차감 확정. 멱등 */
  async applyLeave(requestId: number): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { leaveType: true, usages: true },
    });
    if (!request || request.status !== 'REQUESTED' || request.usages.length > 0) return;

    await this.prisma.$transaction(async (tx) => {
      if (request.leaveType.deductsAnnual) {
        const grants = await tx.leaveGrant.findMany({
          where: { employeeId: request.employeeId, status: 'ACTIVE' },
          include: { usages: true },
          orderBy: { expireDate: 'asc' },
        });
        let toDeduct = request.days;
        for (const g of grants) {
          if (toDeduct <= 0) break;
          const remaining = g.days - g.usages.reduce((s, u) => s + u.days, 0);
          if (remaining <= 0) continue;
          const take = Math.min(remaining, toDeduct);
          await tx.leaveUsage.create({ data: { grantId: g.id, requestId, days: take } });
          if (remaining - take <= 0)
            await tx.leaveGrant.update({ where: { id: g.id }, data: { status: 'EXHAUSTED' } });
          toDeduct -= take;
        }
        if (toDeduct > 0) throw new Error(`잔여 연차 부족으로 차감 실패 (${toDeduct}일 부족)`);
      }
      await tx.leaveRequest.update({ where: { id: requestId }, data: { status: 'APPROVED' } });
      await this.audit.log(
        {
          targetType: 'leave_request',
          targetId: requestId,
          action: 'UPDATE',
          before: { status: 'REQUESTED' },
          after: { status: 'APPROVED', days: request.days },
          reason: '휴가 승인 차감 확정 (시스템)',
        },
        tx,
      );
    });
  }

  async rejectLeave(requestId: number): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'REQUESTED') return;
    await this.prisma.leaveRequest.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
  }

  /** LEAVE_CANCEL 승인 → 사용 복원 (기획서 5.3: 차감 복원) */
  async applyCancel(requestId: number): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { usages: true },
    });
    if (!request || request.status !== 'CANCEL_REQUESTED') return;

    await this.prisma.$transaction(async (tx) => {
      const grantIds = request.usages.map((u) => u.grantId);
      await tx.leaveUsage.deleteMany({ where: { requestId } });
      // 소진됐던 grant 복원 (만료는 복원하지 않음)
      await tx.leaveGrant.updateMany({
        where: { id: { in: grantIds }, status: 'EXHAUSTED' },
        data: { status: 'ACTIVE' },
      });
      await tx.leaveRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
      await this.audit.log(
        {
          targetType: 'leave_request',
          targetId: requestId,
          action: 'UPDATE',
          before: { status: 'CANCEL_REQUESTED' },
          after: { status: 'CANCELLED' },
          reason: '휴가 취소 승인 — 차감 복원 (시스템)',
        },
        tx,
      );
    });
  }

  async rejectCancel(requestId: number): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'CANCEL_REQUESTED') return;
    // 취소 반려 → 승인 상태 유지
    await this.prisma.leaveRequest.update({ where: { id: requestId }, data: { status: 'APPROVED' } });
  }

  // ── 수동 조정 (기획서 LEV-06: 사유 필수, 감사 로그) ──

  async adjust(
    input: { employeeId: number; days: number; reason: string },
    actor: { userId: number; ip?: string },
  ) {
    if (input.days === 0) throw new BadRequestException('조정 일수는 0이 될 수 없습니다.');
    const resolved = await this.resolveLeavePolicy(input.employeeId);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.leaveGrant.create({
        data: {
          employeeId: input.employeeId,
          grantDate: new Date(today),
          days: input.days,
          expireDate: new Date(addMonthsClamped(today, resolved.expireMonths)),
          reason: `[수동 조정] ${input.reason}`,
        },
      });
      await this.audit.log(
        {
          targetType: 'leave_grant',
          targetId: grant.id,
          action: 'CREATE',
          after: grant,
          reason: input.reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return grant;
    });
  }

  // ── 근태 엔진 연결 — 승인된 휴가 일자 (기획서 5.2 엔진 입력) ──

  async approvedDates(employeeId: number, from: Date, to: Date): Promise<Set<string>> {
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: { in: ['APPROVED', 'CANCEL_REQUESTED'] }, // 취소 승인 전까지는 유효
        startDate: { lte: to },
        endDate: { gte: from },
      },
    });
    const dates = new Set<string>();
    for (const r of requests) {
      for (let d = new Date(r.startDate); d <= r.endDate; d = addDays(d, 1)) dates.add(dayKey(d));
    }
    return dates;
  }

  // ── 부서 휴가 캘린더 (기획서 LEV-05) ──

  async calendar(departmentId: number, year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));
    return this.prisma.leaveRequest.findMany({
      where: {
        employee: { departmentId },
        status: { in: ['REQUESTED', 'APPROVED', 'CANCEL_REQUESTED'] },
        startDate: { lte: to },
        endDate: { gte: from },
      },
      include: {
        employee: { select: { id: true, name: true } },
        leaveType: { select: { name: true } },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  // ── 배치 (기획서 5.4 등록 작업 — 멱등) ──

  private async resolveLeavePolicy(employeeId: number): Promise<LeavePolicyShape> {
    const resolved = await this.resolver.resolveLeavePolicy(employeeId);
    if (resolved.source === 'NONE' || !resolved.policy)
      throw new BadRequestException('적용할 연차정책이 없습니다.');
    return resolved.policy as LeavePolicyShape;
  }

  /** 연차 발생 — grantKey 유니크로 멱등. FISCAL_YEAR 정책은 1단계 미지원(기획서 결정 #1) */
  async runGrantBatch(): Promise<number> {
    const employees = await this.prisma.employee.findMany({ where: { status: 'ACTIVE' } });
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    let created = 0;
    for (const emp of employees) {
      let policy: LeavePolicyShape;
      try {
        policy = await this.resolveLeavePolicy(emp.id);
      } catch {
        continue;
      }
      if (policy.grantBasis !== 'HIRE_DATE') continue;
      const accruals = computeAccruals(emp.id, dayKey(emp.hireDate), todayKey, {
        expireMonths: policy.expireMonths,
      });
      for (const a of accruals) {
        const exists = await this.prisma.leaveGrant.findUnique({ where: { grantKey: a.grantKey } });
        if (exists) continue;
        await this.prisma.leaveGrant.create({
          data: {
            employeeId: emp.id,
            grantKey: a.grantKey,
            grantDate: new Date(a.grantDate),
            days: a.days,
            expireDate: new Date(a.expireDate),
            reason: a.reason,
          },
        });
        created++;
      }
    }
    return created;
  }

  /** 연차 소멸 — 기한 도래 ACTIVE/EXHAUSTED grant 를 EXPIRED 처리, 잔여 기록 */
  async runExpireBatch(): Promise<number> {
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const targets = await this.prisma.leaveGrant.findMany({
      where: { status: { in: ['ACTIVE', 'EXHAUSTED'] }, expireDate: { lt: new Date(todayKey) } },
      include: { usages: true },
    });
    for (const g of targets) {
      const remaining = g.days - g.usages.reduce((s, u) => s + u.days, 0);
      await this.prisma.leaveGrant.update({
        where: { id: g.id },
        data: { status: 'EXPIRED', expiredDays: Math.max(0, remaining) },
      });
    }
    return targets.length;
  }

  /** 연차 촉진 대상 식별 — 정책 promotionDays(D-n) 도래 잔여 보유자 (알림 발송은 M6 아웃박스) */
  async runPromotionBatch(): Promise<number> {
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const today = new Date(todayKey);
    const grants = await this.prisma.leaveGrant.findMany({
      where: { status: 'ACTIVE', expireDate: { gte: today } },
      include: { usages: true },
    });
    let targets = 0;
    for (const g of grants) {
      const remaining = g.days - g.usages.reduce((s, u) => s + u.days, 0);
      if (remaining <= 0) continue;
      let policy: LeavePolicyShape;
      try {
        policy = await this.resolveLeavePolicy(g.employeeId);
      } catch {
        continue;
      }
      const dLeft = Math.round((g.expireDate.getTime() - today.getTime()) / 86400000);
      if (policy.promotionDays.includes(dLeft)) {
        // 촉진 알림: 본인 + HR (기획서 4.12)
        await this.notifications.publishToEmployees([g.employeeId], 'leave.promotion', {
          daysLeft: dLeft,
          remaining,
        });
        const hrUsers = await this.prisma.user.findMany({
          where: { isActive: true, userRoles: { some: { role: { code: 'HR' } } } },
          select: { id: true },
        });
        await this.notifications.publish(hrUsers.map((u) => u.id), 'leave.promotion', {
          daysLeft: dLeft,
          remaining,
        });
        targets++;
      }
    }
    return targets;
  }
}
