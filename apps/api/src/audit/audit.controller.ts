import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.decorator';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit-logs')
  @RequirePermission('audit.read')
  list(
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.audit.list({
      targetType,
      targetId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('access-logs')
  @RequirePermission('audit.read')
  listAccess(
    @Query('userId') userId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.audit.listAccess({
      userId: userId ? Number(userId) : undefined,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}
