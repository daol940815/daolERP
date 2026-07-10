import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../approval/approval.service';

const hhmmToMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

@Injectable()
export class OvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approval: ApprovalService,
  ) {}

  /** 신청 — 사전 신청 원칙, 사후 허용은 정책 설정 (기획서 OT-01) */
  async request(
    input: { employeeId: number; date: string; startTime: string; endTime: string; reason: string },
    actor: { userId: number; ip?: string },
  ) {
    const start = hhmmToMin(input.startTime);
    const end = hhmmToMin(input.endTime);
    // 자정 넘김 근무는 종료가 더 작음 — 24h 보정
    const expectedMinutes = end > start ? end - start : 24 * 60 - start + end;
    if (expectedMinutes <= 0 || expectedMinutes > 12 * 60)
      throw new BadRequestException('초과근무 시간이 유효하지 않습니다 (최대 12시간).');

    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    if (input.date < todayKey) {
      const allow = await this.prisma.systemSetting.findUnique({
        where: { key: 'overtime.allowPastRequest' },
      });
      if (allow?.value !== true)
        throw new BadRequestException('사후 초과근무 신청이 허용되지 않습니다 (시스템 설정).');
    }

    const dup = await this.prisma.overtimeRequest.findFirst({
      where: {
        employeeId: input.employeeId,
        date: new Date(input.date),
        status: { in: ['REQUESTED', 'APPROVED'] },
      },
    });
    if (dup) throw new BadRequestException('해당 일자에 이미 신청된 초과근무가 있습니다.');

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.overtimeRequest.create({
        data: {
          employeeId: input.employeeId,
          date: new Date(input.date),
          startTime: input.startTime,
          endTime: input.endTime,
          expectedMinutes,
          reason: input.reason,
        },
      });
      await this.approval.start(
        { requestType: 'OVERTIME', requestId: request.id, applicantEmployeeId: input.employeeId },
        tx,
      );
      await this.audit.log(
        {
          targetType: 'overtime_request',
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
    return this.prisma.overtimeRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async cancel(requestId: number, employeeId: number) {
    const request = await this.prisma.overtimeRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('초과근무 신청을 찾을 수 없습니다.');
    if (request.employeeId !== employeeId)
      throw new ForbiddenException('본인 신청만 취소할 수 있습니다.');
    if (request.status !== 'REQUESTED')
      throw new BadRequestException(`취소할 수 없는 상태입니다: ${request.status}`);

    return this.prisma.$transaction(async (tx) => {
      const approval = await tx.approval.findUnique({
        where: { requestType_requestId: { requestType: 'OVERTIME', requestId } },
      });
      if (approval) await this.approval.cancel(approval.id, tx);
      return tx.overtimeRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
    });
  }

  /** 승인 훅 — 승인된 건만 집계 대상 (기획서 OT-02). 멱등 */
  async applyApprove(requestId: number): Promise<void> {
    await this.prisma.overtimeRequest.updateMany({
      where: { id: requestId, status: 'REQUESTED' },
      data: { status: 'APPROVED' },
    });
  }

  async applyReject(requestId: number): Promise<void> {
    await this.prisma.overtimeRequest.updateMany({
      where: { id: requestId, status: 'REQUESTED' },
      data: { status: 'REJECTED' },
    });
  }

  /** 기간 내 승인된 초과근무 합계 (분) — M7 리포트/마감이 사용 */
  async approvedMinutes(employeeId: number, from: Date, to: Date): Promise<number> {
    const agg = await this.prisma.overtimeRequest.aggregate({
      where: { employeeId, status: 'APPROVED', date: { gte: from, lte: to } },
      _sum: { expectedMinutes: true },
    });
    return agg._sum.expectedMinutes ?? 0;
  }
}
