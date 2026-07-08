import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { IsObject, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

class UpdateSettingsDto {
  /** key → value 맵 (예: { "company.name": "다올커머스" }) */
  @IsObject()
  values: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  reason: string;
}

/** 시스템 설정 (기획서 4.13) — 법인 복제 시 변경 지점 */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async all() {
    const rows = await this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    return rows;
  }

  @Put()
  @RequirePermission('settings.manage')
  async update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const [key, value] of Object.entries(dto.values)) {
        const before = await tx.systemSetting.findUnique({ where: { key } });
        const after = await tx.systemSetting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue, updatedBy: user.id },
          update: { value: value as Prisma.InputJsonValue, updatedBy: user.id },
        });
        await this.audit.log(
          {
            targetType: 'system_setting',
            targetId: key,
            action: before ? 'UPDATE' : 'CREATE',
            before: before?.value,
            after: after.value,
            reason: dto.reason,
            actorUserId: user.id,
            ip: req.ip,
          },
          tx,
        );
        results.push(after);
      }
      return results;
    });
  }
}
