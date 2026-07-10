import { Module } from '@nestjs/common';
import { ReportModule } from '../report/report.module';
import { LeaveModule } from '../leave/leave.module';
import { ClosingService } from './closing.service';
import { ClosingController } from './closing.controller';

/** 월 마감 모듈 [Snapshot] (기획서 4.10) */
@Module({
  imports: [ReportModule, LeaveModule],
  controllers: [ClosingController],
  providers: [ClosingService],
})
export class ClosingModule {}
