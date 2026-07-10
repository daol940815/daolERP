import { Module, OnModuleInit } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { ApprovalService } from '../approval/approval.service';
import { OvertimeService } from './overtime.service';
import { OvertimeController } from './overtime.controller';

/** 초과근무 모듈 [Transaction] (기획서 4.6) */
@Module({
  imports: [ApprovalModule],
  controllers: [OvertimeController],
  providers: [OvertimeService],
  exports: [OvertimeService],
})
export class OvertimeModule implements OnModuleInit {
  constructor(
    private readonly approval: ApprovalService,
    private readonly overtime: OvertimeService,
  ) {}

  onModuleInit() {
    this.approval.registerHooks('OVERTIME', {
      onApproved: (id) => this.overtime.applyApprove(id),
      onRejected: (id) => this.overtime.applyReject(id),
    });
  }
}
