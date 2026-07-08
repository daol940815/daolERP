import { Module, OnModuleInit } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { ApprovalService } from '../approval/approval.service';
import { AttendanceEngineModule } from '../attendance-engine/attendance-engine.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';

/**
 * 출퇴근 모듈 [Transaction] (기획서 4.4).
 * 보정 신청의 승인 후처리(반영/반려)를 승인 모듈에 훅으로 등록한다.
 */
@Module({
  imports: [ApprovalModule, AttendanceEngineModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule implements OnModuleInit {
  constructor(
    private readonly approval: ApprovalService,
    private readonly attendance: AttendanceService,
  ) {}

  onModuleInit() {
    this.approval.registerHooks('ATTENDANCE_CORRECTION', {
      onApproved: (id) => this.attendance.applyCorrection(id),
      onRejected: (id) => this.attendance.rejectCorrection(id),
    });
  }
}
