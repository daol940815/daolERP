import { Global, Module } from '@nestjs/common';
import { ClosingGuardService } from './closing-guard.service';

/**
 * 마감 가드 — 경량 모듈 (prisma 만 의존).
 * 마감된 월의 기록 변경을 차단한다 (기획서 CLS-01: 마감 후 수정 불가).
 * @Global: 출퇴근 보정/휴가 신청/일정 조정 등 기록 변경 지점이 공용.
 */
@Global()
@Module({
  providers: [ClosingGuardService],
  exports: [ClosingGuardService],
})
export class ClosingGuardModule {}
