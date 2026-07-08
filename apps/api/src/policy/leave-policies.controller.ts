import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { LeavePoliciesService } from './leave-policies.service';
import { LeavePolicyInput } from './leave-policies.dto';

@Controller('leave-policies')
export class LeavePoliciesController {
  constructor(private readonly service: LeavePoliciesService) {}

  @Get()
  @RequirePermission('policy.read')
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermission('policy.manage')
  create(@Body() dto: LeavePolicyInput, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.create(dto, { userId: user.id, ip: req.ip });
  }

  @Patch(':id')
  @RequirePermission('policy.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LeavePolicyInput,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, { userId: user.id, ip: req.ip });
  }
}
