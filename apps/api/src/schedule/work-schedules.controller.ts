import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { WorkSchedulesService } from './work-schedules.service';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class GenerateDto {
  @IsOptional()
  @IsInt()
  employeeId?: number; // 미지정 시 전 직원

  @IsInt()
  @Min(2000)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsOptional()
  @IsBoolean()
  preserveManual?: boolean;
}

class AdjustDto {
  @IsInt()
  employeeId: number;

  @IsDateString()
  date: string;

  @IsBoolean()
  isWorkday: boolean;

  @IsOptional()
  @Matches(HHMM)
  plannedStart?: string;

  @IsOptional()
  @Matches(HHMM)
  plannedEnd?: string;

  @IsOptional()
  @IsInt()
  breakMinutes?: number;

  @IsString()
  @MinLength(1)
  reason: string;
}

@Controller('work-schedules')
export class WorkSchedulesController {
  constructor(private readonly service: WorkSchedulesService) {}

  @Get()
  @RequirePermission('schedule.read')
  list(
    @Query('employeeId') employeeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.list({ employeeId: Number(employeeId), from, to });
  }

  @Post('generate')
  @RequirePermission('schedule.manage')
  generate(@Body() dto: GenerateDto) {
    if (dto.employeeId) {
      return this.service.generateForEmployeeMonth(dto.employeeId, dto.year, dto.month, {
        preserveManual: dto.preserveManual ?? true,
      });
    }
    return this.service.generateAllForMonth(dto.year, dto.month);
  }

  @Post('adjust')
  @RequirePermission('schedule.manage')
  adjust(@Body() dto: AdjustDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.adjust(dto, { userId: user.id, ip: req.ip });
  }
}
