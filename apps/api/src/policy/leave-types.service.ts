import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { LeaveTypeInput } from './leave-types.dto';

@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.leaveType.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }

  async create(dto: LeaveTypeInput, actor: { userId: number; ip?: string }) {
    const dup = await this.prisma.leaveType.findUnique({ where: { code: dto.code } });
    if (dup) throw new BadRequestException(`이미 존재하는 휴가 유형 코드입니다: ${dto.code}`);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.leaveType.create({ data: this.toData(dto) });
      await this.audit.log(
        {
          targetType: 'leave_type',
          targetId: created.id,
          action: 'CREATE',
          after: created,
          reason: '휴가 유형 등록',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return created;
    });
  }

  async update(id: number, dto: LeaveTypeInput, actor: { userId: number; ip?: string }) {
    const before = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('휴가 유형을 찾을 수 없습니다.');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.leaveType.update({
        where: { id },
        // code 는 변경 불가 (참조 안정성)
        data: { ...this.toData(dto), code: before.code },
      });
      await this.audit.log(
        {
          targetType: 'leave_type',
          targetId: id,
          action: 'UPDATE',
          before,
          after,
          reason: '휴가 유형 수정',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return after;
    });
  }

  private toData(dto: LeaveTypeInput) {
    return {
      code: dto.code,
      name: dto.name,
      paidType: dto.paidType,
      deductsAnnual: dto.deductsAnnual,
      attachmentRule: dto.attachmentRule,
      allowHalfDay: dto.allowHalfDay,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive,
    };
  }
}
