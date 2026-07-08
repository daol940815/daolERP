import { Body, Controller, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { WorkPoliciesService } from './work-policies.service';
import { CreateWorkPolicyDto, AddWorkPolicyVersionDto } from './work-policies.dto';

@Controller('work-policies')
export class WorkPoliciesController {
  constructor(private readonly service: WorkPoliciesService) {}

  @Get()
  @RequirePermission('policy.read')
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermission('policy.read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermission('policy.manage')
  create(@Body() dto: CreateWorkPolicyDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.create(dto, { userId: user.id, ip: req.ip });
  }

  @Post(':id/versions')
  @RequirePermission('policy.manage')
  addVersion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddWorkPolicyVersionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.addVersion(id, dto, { userId: user.id, ip: req.ip });
  }
}
