import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { HolidayInput } from './holidays.dto';

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(year?: number) {
    const where =
      year !== undefined
        ? { date: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } }
        : {};
    return this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  /**
   * 특정 일자가 휴일인지 판정 (M3 근무일정 생성이 사용).
   * 전사 휴일(departmentId=null) 또는 해당 부서 휴일이면 휴일.
   */
  async isHoliday(date: Date, departmentId: number | null): Promise<boolean> {
    const count = await this.prisma.holiday.count({
      where: {
        date,
        OR: [{ departmentId: null }, ...(departmentId ? [{ departmentId }] : [])],
      },
    });
    return count > 0;
  }

  async create(dto: HolidayInput, actor: { userId: number; ip?: string }) {
    const dup = await this.prisma.holiday.findFirst({
      where: { date: new Date(dto.date), departmentId: dto.departmentId ?? null },
    });
    if (dup) throw new BadRequestException('해당 일자/범위의 휴일이 이미 등록되어 있습니다.');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.holiday.create({
        data: {
          date: new Date(dto.date),
          name: dto.name,
          holidayType: dto.holidayType,
          departmentId: dto.departmentId ?? null,
        },
      });
      await this.audit.log(
        {
          targetType: 'holiday',
          targetId: created.id,
          action: 'CREATE',
          after: created,
          reason: dto.reason ?? '휴일 등록',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      // 기획서 HOL-03: 휴일 변경 시 근무일정 재생성 트리거 — M3 일정 모듈 구현 후 연결
      return created;
    });
  }

  async remove(id: number, reason: string, actor: { userId: number; ip?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.holiday.findUnique({ where: { id } });
      if (!before) throw new BadRequestException('휴일을 찾을 수 없습니다.');
      await tx.holiday.delete({ where: { id } });
      await this.audit.log(
        {
          targetType: 'holiday',
          targetId: id,
          action: 'DELETE',
          before,
          reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return { ok: true };
    });
  }
}
