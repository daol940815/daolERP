import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { IsDateString, IsString, Matches, MinLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { OvertimeService } from './overtime.service';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class OvertimeRequestDto {
  @IsDateString()
  date: string;

  @Matches(HHMM)
  startTime: string;

  @Matches(HHMM)
  endTime: string;

  @IsString()
  @MinLength(1)
  reason: string;
}

@Controller('overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  private requireEmployee(user: AuthUser): number {
    if (!user.employee) throw new BadRequestException('직원 정보가 연결되지 않은 계정입니다.');
    return user.employee.id;
  }

  @Post('requests')
  request(@Body() dto: OvertimeRequestDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.overtime.request(
      { employeeId: this.requireEmployee(user), ...dto },
      { userId: user.id, ip: req.ip },
    );
  }

  @Get('requests')
  list(@CurrentUser() user: AuthUser) {
    return this.overtime.list(this.requireEmployee(user));
  }

  @Post('requests/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.overtime.cancel(id, this.requireEmployee(user));
  }
}
