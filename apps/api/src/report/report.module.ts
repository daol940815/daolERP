import { Module } from '@nestjs/common';
import { AttendanceEngineModule } from '../attendance-engine/attendance-engine.module';
import { LeaveModule } from '../leave/leave.module';
import { OvertimeModule } from '../overtime/overtime.module';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';

/** 통계/리포트 모듈 (기획서 4.11/4.14) — 엔진을 통해서만 판정 (단일 판정 지점) */
@Module({
  imports: [AttendanceEngineModule, LeaveModule, OvertimeModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
