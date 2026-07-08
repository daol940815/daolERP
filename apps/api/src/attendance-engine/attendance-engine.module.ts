import { Module } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { AttendanceEngineService } from './attendance-engine.service';

/**
 * 근태 계산 엔진 [Engine] — attendance(기록)와 분리된 순수 계산 모듈 (기획서 10.2).
 * 판정 로직은 day-calculator.ts (순수 함수 + 단위 테스트)에만 존재한다.
 */
@Module({
  imports: [PolicyModule],
  providers: [AttendanceEngineService],
  exports: [AttendanceEngineService],
})
export class AttendanceEngineModule {}
