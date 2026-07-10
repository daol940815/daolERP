import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LeavesService } from '../leave/leaves.service';

/**
 * 퇴사 프로세스 (기획서 4.1.4) — 퇴사일 입력으로 끝나지 않고 하나의 프로세스로 처리:
 * 1. 승인자 정리 검증 (대체 지정 전 차단) → 2. 재직 상태 변경 + 이력
 * 3. 로그인 비활성화 → 4. 미래 근무일정 삭제 → 5. 본인 대기 신청 자동 취소
 * 6. 연차 정산 근거 데이터 반환
 */
@Injectable()
export class ResignationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leaves: LeavesService,
  ) {}

  async resign(
    employeeId: number,
    input: { resignDate: string; reason: string },
    actor: { userId: number; ip?: string },
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');
    if (employee.status === 'RESIGNED') throw new BadRequestException('이미 퇴사 처리된 직원입니다.');

    // ── 1. 승인자 정리 검증 — 대체 지정 완료 전 퇴사 처리 차단 (기획서 4.1.4-5) ──
    const headOf = await this.prisma.department.findMany({
      where: { headEmployeeId: employeeId, isActive: true },
      select: { id: true, name: true },
    });
    if (headOf.length > 0)
      throw new BadRequestException(
        `부서장으로 지정된 부서가 있습니다: ${headOf.map((d) => d.name).join(', ')} — 대체 부서장 지정 후 퇴사 처리하세요.`,
      );
    const specificSteps = await this.prisma.approvalLineStep.count({
      where: { approverEmployeeId: employeeId, approvalLine: { isActive: true } },
    });
    if (specificSteps > 0)
      throw new BadRequestException(
        '승인라인의 지정 승인자로 등록되어 있습니다 — 승인라인 수정 후 퇴사 처리하세요.',
      );
    const pendingToApprove = await this.prisma.approvalStepRecord.count({
      where: {
        approverEmployeeId: employeeId,
        decision: 'PENDING',
        approval: { status: 'IN_PROGRESS' },
      },
    });
    if (pendingToApprove > 0)
      throw new BadRequestException(
        `이 직원에게 대기 중인 결재 ${pendingToApprove}건이 있습니다 — 처리 또는 재배정 후 퇴사 처리하세요.`,
      );

    const resignDate = new Date(input.resignDate);
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const isPastOrToday = input.resignDate <= todayKey;
    const newStatus = isPastOrToday ? 'RESIGNED' : 'RESIGNING';

    const result = await this.prisma.$transaction(async (tx) => {
      // ── 2. 재직 상태 변경 + 발효일 이력 ──
      const after = await tx.employee.update({
        where: { id: employeeId },
        data: { status: newStatus, resignDate },
      });
      await tx.employeeHistory.create({
        data: {
          employeeId,
          changeType: 'STATUS',
          beforeValue: { status: employee.status },
          afterValue: { status: newStatus, resignDate: input.resignDate },
          effectiveDate: resignDate,
          reason: input.reason,
          createdBy: actor.userId,
        },
      });

      // ── 3. 로그인 비활성화 (퇴사일 도래 시. 미래 퇴사는 RESIGNING — 도래 후 재실행으로 차단) ──
      if (isPastOrToday) {
        await tx.user.updateMany({ where: { employeeId }, data: { isActive: false } });
      }

      // ── 4. 퇴사일 이후 근무일정 삭제 ──
      const deletedSchedules = await tx.workSchedule.deleteMany({
        where: { employeeId, date: { gt: resignDate } },
      });

      // ── 5. 본인 대기 신청 자동 취소 (휴가/초과근무/보정 + 승인 인스턴스) ──
      const [leaveReqs, otReqs, corrReqs] = await Promise.all([
        tx.leaveRequest.findMany({ where: { employeeId, status: 'REQUESTED' } }),
        tx.overtimeRequest.findMany({ where: { employeeId, status: 'REQUESTED' } }),
        tx.attendanceCorrection.findMany({ where: { employeeId, status: 'REQUESTED' } }),
      ]);
      const toCancel: { type: string; id: number }[] = [
        ...leaveReqs.map((r) => ({ type: 'LEAVE', id: r.id })),
        ...otReqs.map((r) => ({ type: 'OVERTIME', id: r.id })),
        ...corrReqs.map((r) => ({ type: 'ATTENDANCE_CORRECTION', id: r.id })),
      ];
      for (const c of toCancel) {
        await tx.approval.updateMany({
          where: { requestType: c.type, requestId: c.id, status: 'IN_PROGRESS' },
          data: { status: 'CANCELLED' },
        });
      }
      await tx.leaveRequest.updateMany({
        where: { employeeId, status: 'REQUESTED' },
        data: { status: 'CANCELLED' },
      });
      await tx.overtimeRequest.updateMany({
        where: { employeeId, status: 'REQUESTED' },
        data: { status: 'CANCELLED' },
      });
      await tx.attendanceCorrection.updateMany({
        where: { employeeId, status: 'REQUESTED' },
        data: { status: 'CANCELLED' },
      });

      await this.audit.log(
        {
          targetType: 'employee',
          targetId: employeeId,
          action: 'UPDATE',
          before: { status: employee.status, resignDate: employee.resignDate },
          after: { status: newStatus, resignDate: input.resignDate },
          reason: `[퇴사 처리] ${input.reason}`,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );

      return {
        employee: after,
        cancelledRequests: toCancel.length,
        deletedFutureSchedules: deletedSchedules.count,
      };
    });

    // ── 6. 연차 정산 근거 (미사용 수당 계산은 급여 영역 — 제외 범위) ──
    const settlement = await this.leaves.balance(employeeId);
    return { ...result, leaveSettlement: settlement.summary };
  }
}
