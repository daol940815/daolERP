import { Body, Controller, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ApprovalService } from './approval.service';
import { ApprovalLinesService } from './approval-lines.service';
import { CreateApprovalLineDto, AssignApprovalLineDto } from './approval-lines.dto';

class DecisionDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

class StartApprovalDto {
  @IsString()
  requestType: string;

  @IsInt()
  requestId: number;

  @IsInt()
  applicantEmployeeId: number;
}

@Controller('approvals')
export class ApprovalController {
  constructor(
    private readonly approval: ApprovalService,
    private readonly lines: ApprovalLinesService,
  ) {}

  // ── 승인라인 관리 (기획서 APV-01~03) ──
  @Get('lines')
  @RequirePermission('approval.manage')
  listLines() {
    return this.lines.list();
  }

  @Post('lines')
  @RequirePermission('approval.manage')
  createLine(@Body() dto: CreateApprovalLineDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.lines.create(dto, { userId: user.id, ip: req.ip });
  }

  @Post('lines/:id/assign')
  @RequirePermission('approval.manage')
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignApprovalLineDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.lines.assign(id, dto, { userId: user.id, ip: req.ip });
  }

  // ── 승인 처리 (전 로그인 사용자 — 본인 단계만 처리 가능, 서비스가 검증) ──
  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser) {
    if (!user.employee) return [];
    return this.approval.inbox(user.employee.id);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.approval.get(id);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.approval.approve(id, user.id, dto.comment);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: DecisionDto, @CurrentUser() user: AuthUser) {
    return this.approval.reject(id, user.id, dto.comment);
  }

  /**
   * 승인 인스턴스 시작 — 정식으로는 M4+ 신청 모듈이 ApprovalService.start 를 직접 호출한다.
   * M3 단계에서는 엔진 검증용으로 HTTP 엔드포인트를 열어둔다 (approval.manage 권한).
   */
  @Post('start')
  @RequirePermission('approval.manage')
  start(@Body() dto: StartApprovalDto) {
    return this.approval.start(dto);
  }
}
