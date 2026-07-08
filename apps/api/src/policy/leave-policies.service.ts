import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { LeavePolicyInput } from './leave-policies.dto';

@Injectable()
export class LeavePoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.leavePolicy.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { employees: true, departments: true } } },
    });
  }

  async create(dto: LeavePolicyInput, actor: { userId: number; ip?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.leavePolicy.create({ data: this.toData(dto) });
      await this.audit.log(
        {
          targetType: 'leave_policy',
          targetId: created.id,
          action: 'CREATE',
          after: created,
          reason: dto.reason ?? '연차정책 등록',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return created;
    });
  }

  async update(id: number, dto: LeavePolicyInput, actor: { userId: number; ip?: string }) {
    const before = await this.prisma.leavePolicy.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('연차정책을 찾을 수 없습니다.');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.leavePolicy.update({ where: { id }, data: this.toData(dto) });
      await this.audit.log(
        {
          targetType: 'leave_policy',
          targetId: id,
          action: 'UPDATE',
          before,
          after,
          reason: dto.reason ?? '연차정책 수정',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return after;
    });
  }

  private toData(dto: LeavePolicyInput) {
    return {
      name: dto.name,
      grantBasis: dto.grantBasis,
      fiscalStartMonth: dto.fiscalStartMonth,
      expireMonths: dto.expireMonths,
      carryOver: dto.carryOver,
      carryOverLimit: dto.carryOverLimit ?? null,
      autoExpire: dto.autoExpire,
      promotionDays: dto.promotionDays,
      minUnit: dto.minUnit,
      isActive: dto.isActive,
    };
  }
}
