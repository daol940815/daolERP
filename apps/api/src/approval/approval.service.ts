import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PolicySource } from '@daolerp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ApproverResolverService } from './approver-resolver.service';

export interface StartApprovalInput {
  requestType: string;
  requestId: number;
  applicantEmployeeId: number;
}

/**
 * 승인 엔진 (독립 모듈, 기획서 4.7/5.3).
 * M4(근태 보정)·M5(휴가)·M6(초과근무)가 start/approve/reject/cancel 로 사용한다.
 * 상태기계: IN_PROGRESS → (단계 승인 반복) → APPROVED / REJECTED / CANCELLED.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approverResolver: ApproverResolverService,
  ) {}

  /** (직원, 신청유형)에 적용될 승인라인 해석 — 개인 > 부서 > 유형 기본 라인 */
  async resolveLine(
    employeeId: number,
    requestType: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ source: PolicySource; lineId: number | null }> {
    const db = tx ?? this.prisma;
    const emp = await db.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new NotFoundException('직원을 찾을 수 없습니다.');

    const empAssign = await db.approvalLineAssignment.findFirst({
      where: { employeeId, approvalLine: { requestType, isActive: true } },
    });
    if (empAssign) return { source: 'EMPLOYEE', lineId: empAssign.approvalLineId };

    if (emp.departmentId) {
      const deptAssign = await db.approvalLineAssignment.findFirst({
        where: {
          departmentId: emp.departmentId,
          approvalLine: { requestType, isActive: true },
        },
      });
      if (deptAssign) return { source: 'DEPARTMENT', lineId: deptAssign.approvalLineId };
    }

    const def = await db.approvalLine.findFirst({
      where: { requestType, isDefault: true, isActive: true },
    });
    if (def) return { source: 'DEFAULT', lineId: def.id };

    return { source: 'NONE', lineId: null };
  }

  /**
   * 승인 인스턴스 생성 — 라인을 해석하고 각 단계의 승인자를 확정하여
   * step records 를 PENDING 으로 생성. 동일 트랜잭션(tx)에서 호출 권장.
   */
  async start(input: StartApprovalInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const { source, lineId } = await this.resolveLine(
      input.applicantEmployeeId,
      input.requestType,
      tx,
    );
    if (source === 'NONE' || !lineId)
      throw new BadRequestException(`적용할 승인라인이 없습니다: ${input.requestType}`);

    const steps = await db.approvalLineStep.findMany({
      where: { approvalLineId: lineId },
      orderBy: { stepOrder: 'asc' },
    });
    if (steps.length === 0) throw new BadRequestException('승인라인에 단계가 정의되지 않았습니다.');

    const approval = await db.approval.create({
      data: {
        requestType: input.requestType,
        requestId: input.requestId,
        applicantEmployeeId: input.applicantEmployeeId,
        approvalLineId: lineId,
        currentStep: 1,
        status: 'IN_PROGRESS',
      },
    });

    for (const step of steps) {
      const approverId = await this.approverResolver.resolve(
        step,
        input.applicantEmployeeId,
        tx,
      );
      await db.approvalStepRecord.create({
        data: {
          approvalId: approval.id,
          stepOrder: step.stepOrder,
          approverEmployeeId: approverId,
          decision: 'PENDING',
        },
      });
    }
    return approval;
  }

  /** 현재 단계 승인 처리. 마지막 단계면 전체 APPROVED */
  async approve(approvalId: number, approverUserId: number, comment?: string) {
    return this.decide(approvalId, approverUserId, 'APPROVED', comment);
  }

  /** 현재 단계 반려 → 즉시 REJECTED (기획서 5.3) */
  async reject(approvalId: number, approverUserId: number, comment?: string) {
    return this.decide(approvalId, approverUserId, 'REJECTED', comment);
  }

  private async decide(
    approvalId: number,
    approverUserId: number,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) {
    const approverEmp = await this.prisma.user.findUnique({ where: { id: approverUserId } });
    const approverEmployeeId = approverEmp?.employeeId ?? null;

    return this.prisma.$transaction(async (tx) => {
      const approval = await tx.approval.findUnique({
        where: { id: approvalId },
        include: { stepRecords: { orderBy: { stepOrder: 'asc' } } },
      });
      if (!approval) throw new NotFoundException('승인 건을 찾을 수 없습니다.');
      if (approval.status !== 'IN_PROGRESS')
        throw new BadRequestException(`처리할 수 없는 상태입니다: ${approval.status}`);

      const current = approval.stepRecords.find((r) => r.stepOrder === approval.currentStep);
      if (!current) throw new BadRequestException('현재 단계를 찾을 수 없습니다.');
      if (current.approverEmployeeId == null)
        throw new BadRequestException('현재 단계의 승인자가 지정되지 않았습니다.');
      if (current.approverEmployeeId !== approverEmployeeId)
        throw new ForbiddenException('현재 단계의 승인자가 아닙니다.');

      await tx.approvalStepRecord.update({
        where: { id: current.id },
        data: { decision, comment, decidedAt: new Date() },
      });

      const isLastStep = approval.currentStep >= Math.max(...approval.stepRecords.map((r) => r.stepOrder));
      let newStatus = approval.status;
      let nextStep = approval.currentStep;
      if (decision === 'REJECTED') {
        newStatus = 'REJECTED';
      } else if (isLastStep) {
        newStatus = 'APPROVED';
      } else {
        nextStep = approval.currentStep + 1;
      }

      return tx.approval.update({
        where: { id: approvalId },
        data: { status: newStatus, currentStep: nextStep },
        include: { stepRecords: { orderBy: { stepOrder: 'asc' } } },
      });
    });
  }

  /** 원 신청 취소 시 호출 (신청 모듈이 위임) */
  async cancel(approvalId: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const approval = await db.approval.findUnique({ where: { id: approvalId } });
    if (!approval) return null;
    if (approval.status !== 'IN_PROGRESS') return approval;
    return db.approval.update({ where: { id: approvalId }, data: { status: 'CANCELLED' } });
  }

  /** 승인함 — 특정 승인자에게 현재 대기 중인 건 (기획서 APV-05) */
  async inbox(approverEmployeeId: number) {
    const records = await this.prisma.approvalStepRecord.findMany({
      where: {
        approverEmployeeId,
        decision: 'PENDING',
        approval: { status: 'IN_PROGRESS' },
      },
      include: {
        approval: { include: { applicant: { select: { name: true, empNo: true } } } },
      },
    });
    // 현재 단계인 건만 (내 단계 차례가 온 것)
    return records.filter((r) => r.approval.currentStep === r.stepOrder);
  }

  get(approvalId: number) {
    return this.prisma.approval.findUnique({
      where: { id: approvalId },
      include: {
        applicant: { select: { name: true, empNo: true } },
        approvalLine: true,
        stepRecords: {
          orderBy: { stepOrder: 'asc' },
          include: { approverEmployee: { select: { name: true, empNo: true } } },
        },
      },
    });
  }
}
