import { Module } from '@nestjs/common';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';
import { ApprovalLinesService } from './approval-lines.service';
import { ApproverResolverService } from './approver-resolver.service';

/**
 * 승인 모듈 (독립 — 전 신청 유형 공통. 기획서 4.7).
 * M4(보정)·M5(휴가)·M6(초과근무)가 ApprovalService 를 주입받아 사용한다.
 * ApprovalService 를 export 하여 타 모듈이 start/cancel 을 호출할 수 있게 한다.
 */
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService, ApprovalLinesService, ApproverResolverService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
