import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateApprovalLineDto, AssignApprovalLineDto } from './approval-lines.dto';

@Injectable()
export class ApprovalLinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(requestType?: string) {
    return this.prisma.approvalLine.findMany({
      where: { requestType },
      orderBy: { id: 'asc' },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: { approverEmployee: { select: { name: true, empNo: true } } },
        },
        assignments: {
          include: {
            employee: { select: { name: true, empNo: true } },
            department: { select: { name: true } },
          },
        },
      },
    });
  }

  /** 라인 + 단계 동시 생성 */
  async create(dto: CreateApprovalLineDto, actor: { userId: number; ip?: string }) {
    if (dto.steps.length === 0) throw new BadRequestException('단계를 최소 1개 정의해야 합니다.');
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        // 유형별 기본 라인은 하나만 — 기존 기본 해제
        await tx.approvalLine.updateMany({
          where: { requestType: dto.requestType, isDefault: true },
          data: { isDefault: false },
        });
      }
      const line = await tx.approvalLine.create({
        data: {
          name: dto.name,
          requestType: dto.requestType,
          isDefault: dto.isDefault ?? false,
          steps: {
            create: dto.steps.map((s, i) => ({
              stepOrder: i + 1,
              approverType: s.approverType,
              approverEmployeeId: s.approverEmployeeId ?? null,
              approverJobTitleCode: s.approverJobTitleCode ?? null,
            })),
          },
        },
        include: { steps: true },
      });
      await this.audit.log(
        {
          targetType: 'approval_line',
          targetId: line.id,
          action: 'CREATE',
          after: line,
          reason: '승인라인 등록',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return line;
    });
  }

  /** 라인을 직원 또는 부서에 배정 */
  async assign(lineId: number, dto: AssignApprovalLineDto, actor: { userId: number; ip?: string }) {
    const line = await this.prisma.approvalLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundException('승인라인을 찾을 수 없습니다.');
    if (!dto.employeeId && !dto.departmentId)
      throw new BadRequestException('직원 또는 부서 중 하나를 지정해야 합니다.');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.approvalLineAssignment.create({
        data: {
          approvalLineId: lineId,
          employeeId: dto.employeeId ?? null,
          departmentId: dto.departmentId ?? null,
        },
      });
      await this.audit.log(
        {
          targetType: 'approval_line_assignment',
          targetId: created.id,
          action: 'CREATE',
          after: created,
          reason: dto.reason ?? '승인라인 배정',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return created;
    });
  }
}
