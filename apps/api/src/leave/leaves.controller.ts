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
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { LeavesService } from './leaves.service';

class LeaveRequestDto {
  @IsString()
  leaveTypeCode: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  halfDay?: boolean;

  @IsString()
  @MinLength(1)
  reason: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  attachmentIds?: number[];
}

class AdjustDto {
  @IsInt()
  employeeId: number;

  @IsNumber()
  days: number; // 음수 = 차감

  @IsString()
  @MinLength(1)
  reason: string;
}

@Controller('leaves')
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  private requireEmployee(user: AuthUser): number {
    if (!user.employee) throw new BadRequestException('직원 정보가 연결되지 않은 계정입니다.');
    return user.employee.id;
  }

  @Get('balance')
  myBalance(@CurrentUser() user: AuthUser) {
    return this.leaves.balance(this.requireEmployee(user));
  }

  @Get('balance/:employeeId')
  async balanceOf(@Param('employeeId', ParseIntPipe) employeeId: number, @CurrentUser() user: AuthUser) {
    if (user.employee?.id !== employeeId) {
      const ok = user.permissions.some((p) => p.action === 'leave.read' && p.scope === 'ALL');
      if (!ok) throw new ForbiddenException('해당 직원의 연차를 조회할 권한이 없습니다.');
    }
    return this.leaves.balance(employeeId);
  }

  @Post('requests')
  request(@Body() dto: LeaveRequestDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.leaves.request(
      { employeeId: this.requireEmployee(user), ...dto },
      { userId: user.id, ip: req.ip },
    );
  }

  @Get('requests')
  list(@CurrentUser() user: AuthUser) {
    return this.leaves.list(this.requireEmployee(user));
  }

  @Post('requests/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.leaves.cancel(id, this.requireEmployee(user));
  }

  /** 부서 휴가 캘린더 — 기본은 본인 부서, 타 부서는 leave.read ALL (기획서 LEV-05) */
  @Get('calendar')
  calendar(
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentUser() user: AuthUser,
    @Query('departmentId') departmentId?: string,
  ) {
    const own = user.employee?.departmentId;
    let target = departmentId ? Number(departmentId) : own;
    if (target == null) throw new BadRequestException('부서 정보가 없습니다.');
    if (target !== own) {
      const ok = user.permissions.some((p) => p.action === 'leave.read' && p.scope === 'ALL');
      if (!ok) throw new ForbiddenException('타 부서 캘린더를 조회할 권한이 없습니다.');
    }
    return this.leaves.calendar(target, Number(year), Number(month));
  }

  @Post('adjust')
  @RequirePermission('leave.adjust')
  adjust(@Body() dto: AdjustDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.leaves.adjust(dto, { userId: user.id, ip: req.ip });
  }
}
