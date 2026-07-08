import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        employee: { select: { id: true, empNo: true, name: true } },
        userRoles: { select: { role: { select: { code: true, name: true } } } },
      },
      orderBy: { id: 'asc' },
    });
  }

  /** 계정 생성 — Employee 연결은 선택 (외부 사용자/시스템 계정은 User만, 기획서 3.1) */
  async create(
    input: { email: string; password: string; employeeId?: number; roleCodes: string[] },
    actor: { userId: number; ip?: string },
  ) {
    const dup = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (dup) throw new BadRequestException('이미 존재하는 이메일입니다.');
    if (input.employeeId) {
      const linked = await this.prisma.user.findUnique({
        where: { employeeId: input.employeeId },
      });
      if (linked) throw new BadRequestException('해당 직원에 이미 계정이 연결되어 있습니다.');
    }
    const roles = await this.prisma.role.findMany({ where: { code: { in: input.roleCodes } } });
    if (roles.length !== input.roleCodes.length)
      throw new BadRequestException('존재하지 않는 역할이 포함되어 있습니다.');

    const passwordHash = await bcrypt.hash(input.password, 10);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          employeeId: input.employeeId,
          userRoles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
        select: { id: true, email: true, employeeId: true, isActive: true },
      });
      await this.audit.log(
        {
          targetType: 'user',
          targetId: user.id,
          action: 'CREATE',
          after: { email: user.email, employeeId: user.employeeId, roles: input.roleCodes },
          reason: '계정 생성',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return user;
    });
  }

  /** 활성/비활성 및 역할 변경 */
  async update(
    id: number,
    input: { isActive?: boolean; roleCodes?: string[]; reason: string },
    actor: { userId: number; ip?: string },
  ) {
    const before = await this.prisma.user.findUnique({
      where: { id },
      include: { userRoles: { include: { role: true } } },
    });
    if (!before) throw new NotFoundException('계정을 찾을 수 없습니다.');

    return this.prisma.$transaction(async (tx) => {
      if (input.roleCodes) {
        const roles = await tx.role.findMany({ where: { code: { in: input.roleCodes } } });
        if (roles.length !== input.roleCodes.length)
          throw new BadRequestException('존재하지 않는 역할이 포함되어 있습니다.');
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
      }
      const after = await tx.user.update({
        where: { id },
        data: { isActive: input.isActive },
        select: { id: true, email: true, isActive: true },
      });
      await this.audit.log(
        {
          targetType: 'user',
          targetId: id,
          action: 'UPDATE',
          before: {
            isActive: before.isActive,
            roles: before.userRoles.map((ur) => ur.role.code),
          },
          after: { isActive: after.isActive, roles: input.roleCodes },
          reason: input.reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return after;
    });
  }
}
