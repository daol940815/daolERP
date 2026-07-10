import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { LoginResponse, MeResponse, PermissionScope, RoleCode } from '@daolerp/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));

    if (!valid) {
      // 접속 로그: 실패도 기록 (기획서 6장 접속 기록)
      await this.prisma.accessLog.create({
        data: {
          userId: user?.id ?? null,
          event: 'LOGIN_FAILED',
          detail: email,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.accessLog.create({
        data: { userId: user.id, event: 'LOGIN', ip: meta.ip, userAgent: meta.userAgent },
      }),
    ]);

    const me = await this.buildMe(user.id);
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken, user: me };
  }

  async logout(userId: number, meta: RequestMeta): Promise<void> {
    await this.prisma.accessLog.create({
      data: { userId, event: 'LOGOUT', ip: meta.ip, userAgent: meta.userAgent },
    });
  }

  /** 비밀번호 변경 — 현재 비밀번호 확인 필수. 운영 오픈 시 초기 비밀번호 교체용 */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다.');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(newPassword, 10) },
      }),
      this.prisma.accessLog.create({
        data: {
          userId,
          event: 'LOGIN', // 접속 이벤트 체계 유지 — 상세는 detail 로 구분
          detail: 'PASSWORD_CHANGED',
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      }),
    ]);
  }

  /** 사용자 정보 + 역할 + 권한(action/scope) 조회 — 가드와 /auth/me 가 공용 */
  async buildMe(userId: number): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        employee: { include: { department: true } },
        userRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        },
      },
    });

    const roles = user.userRoles.map((ur) => ur.role.code as RoleCode);
    const permMap = new Map<string, { action: string; scope: PermissionScope }>();
    for (const ur of user.userRoles) {
      for (const rp of ur.role.rolePermissions) {
        const key = `${rp.permission.action}:${rp.permission.scope}`;
        permMap.set(key, {
          action: rp.permission.action,
          scope: rp.permission.scope as PermissionScope,
        });
      }
    }

    return {
      id: user.id,
      email: user.email,
      employee: user.employee
        ? {
            id: user.employee.id,
            empNo: user.employee.empNo,
            name: user.employee.name,
            departmentId: user.employee.departmentId,
            departmentName: user.employee.department?.name ?? null,
          }
        : null,
      roles,
      permissions: [...permMap.values()],
    };
  }
}
