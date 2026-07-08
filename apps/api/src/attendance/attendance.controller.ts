import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import type { Request } from 'express';
import { ATTENDANCE_EVENT_TYPES } from '@daolerp/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class ClockDto {
  @IsIn([...ATTENDANCE_EVENT_TYPES])
  eventType: string;
}

class CorrectionDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @Matches(HHMM)
  clockIn?: string;

  @IsOptional()
  @Matches(HHMM)
  clockOut?: string;

  @IsString()
  @MinLength(1)
  reason: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  attachmentIds?: number[];
}

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly prisma: PrismaService,
  ) {}

  /** 본인 employee 확인 — User↔Employee 1:0..1, 직원 아닌 계정은 근태 기능 불가 */
  private requireEmployee(user: AuthUser): number {
    if (!user.employee) throw new BadRequestException('직원 정보가 연결되지 않은 계정입니다.');
    return user.employee.id;
  }

  /** 스코프 검사 — SELF: 본인, DEPT: 같은 부서, ALL: 전사 (기획서 3.3) */
  private async checkReadScope(user: AuthUser, targetEmployeeId: number): Promise<void> {
    if (user.employee?.id === targetEmployeeId) return; // 본인은 항상 허용
    const perms = user.permissions.filter((p) => p.action === 'attendance.read');
    if (perms.some((p) => p.scope === 'ALL')) return;
    if (perms.some((p) => p.scope === 'DEPT')) {
      const target = await this.prisma.employee.findUnique({ where: { id: targetEmployeeId } });
      if (target && target.departmentId != null && target.departmentId === user.employee?.departmentId) return;
    }
    throw new ForbiddenException('해당 직원의 근태를 조회할 권한이 없습니다.');
  }

  @Post('clock')
  clock(@Body() dto: ClockDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const employeeId = this.requireEmployee(user);
    return this.attendance.clock(employeeId, dto.eventType, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser, @Query('from') from: string, @Query('to') to: string) {
    const employeeId = this.requireEmployee(user);
    return this.attendance.daily(employeeId, from, to);
  }

  @Get('daily/:employeeId')
  async daily(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.checkReadScope(user, employeeId);
    return this.attendance.daily(employeeId, from, to);
  }

  // ── 보정 신청 ──

  @Post('corrections')
  requestCorrection(@Body() dto: CorrectionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const employeeId = this.requireEmployee(user);
    return this.attendance.requestCorrection(
      { employeeId, ...dto },
      { userId: user.id, ip: req.ip },
    );
  }

  @Get('corrections')
  listCorrections(@CurrentUser() user: AuthUser) {
    return this.attendance.listCorrections(this.requireEmployee(user));
  }

  @Post('corrections/:id/cancel')
  cancelCorrection(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.attendance.cancelCorrection(id, this.requireEmployee(user));
  }
}
