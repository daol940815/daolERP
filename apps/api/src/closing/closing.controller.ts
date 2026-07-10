import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ClosingService } from './closing.service';

class ReopenDto {
  @IsString()
  @MinLength(1)
  reason: string;
}

@Controller('closings')
export class ClosingController {
  constructor(private readonly closing: ClosingService) {}

  @Get(':yearMonth')
  @RequirePermission('closing.execute')
  get(@Param('yearMonth') yearMonth: string) {
    return this.closing.get(yearMonth);
  }

  @Get(':yearMonth/validate')
  @RequirePermission('closing.execute')
  validate(@Param('yearMonth') yearMonth: string) {
    return this.closing.validate(yearMonth);
  }

  @Post(':yearMonth/close')
  @RequirePermission('closing.execute')
  close(@Param('yearMonth') yearMonth: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.closing.close(yearMonth, { userId: user.id, ip: req.ip });
  }

  @Post(':yearMonth/reopen')
  @RequirePermission('closing.execute')
  reopen(
    @Param('yearMonth') yearMonth: string,
    @Body() dto: ReopenDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.closing.reopen(yearMonth, dto.reason, { userId: user.id, ip: req.ip });
  }

  @Get(':yearMonth/export')
  @RequirePermission('closing.execute')
  async export(@Param('yearMonth') yearMonth: string, @Res() res: Response) {
    const buffer = await this.closing.exportXlsx(yearMonth);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=closing-${yearMonth}.xlsx`);
    res.send(buffer);
  }
}
