import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface DepartmentInput {
  name: string;
  parentId?: number | null;
  headEmployeeId?: number | null;
  sortOrder?: number;
  isActive?: boolean;
  workPolicyId?: number | null;
  leavePolicyId?: number | null;
  reason?: string;
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.department.findMany({
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        headEmployee: { select: { id: true, name: true, empNo: true } },
        _count: { select: { employees: true } },
      },
    });
  }

  async create(input: DepartmentInput, actor: { userId: number; ip?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.department.create({
        data: {
          name: input.name,
          parentId: input.parentId ?? null,
          headEmployeeId: input.headEmployeeId ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.audit.log(
        {
          targetType: 'department',
          targetId: created.id,
          action: 'CREATE',
          after: created,
          reason: input.reason ?? '부서 등록',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return created;
    });
  }

  async update(id: number, input: Partial<DepartmentInput>, actor: { userId: number; ip?: string }) {
    const before = await this.prisma.department.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('부서를 찾을 수 없습니다.');
    if (input.parentId === id) throw new BadRequestException('자기 자신을 상위 부서로 지정할 수 없습니다.');

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.department.update({
        where: { id },
        data: {
          name: input.name,
          parentId: input.parentId,
          headEmployeeId: input.headEmployeeId,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
          workPolicyId: input.workPolicyId,
          leavePolicyId: input.leavePolicyId,
        },
      });
      await this.audit.log(
        {
          targetType: 'department',
          targetId: id,
          action: 'UPDATE',
          before,
          after,
          reason: input.reason ?? '부서 수정',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return after;
    });
  }
}
