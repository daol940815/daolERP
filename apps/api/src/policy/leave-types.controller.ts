import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { LeaveTypesService } from './leave-types.service';
import { LeaveTypeInput } from './leave-types.dto';

@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly service: LeaveTypesService) {}

  // 조회는 전 직원 허용 — 휴가 신청 화면의 유형 선택에 필요
  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermission('policy.manage')
  create(@Body() dto: LeaveTypeInput, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.create(dto, { userId: user.id, ip: req.ip });
  }

  @Patch(':id')
  @RequirePermission('policy.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LeaveTypeInput,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, { userId: user.id, ip: req.ip });
  }
}
