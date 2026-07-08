import { Module, OnModuleInit } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { ApprovalService } from '../approval/approval.service';
import { PolicyModule } from '../policy/policy.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SchedulerService } from '../scheduler/scheduler.service';
import { LeavesService } from './leaves.service';
import { LeavesController } from './leaves.controller';

/**
 * 휴가 모듈 [Transaction] + leave engine (기획서 4.5).
 * 승인 훅(LEAVE/LEAVE_CANCEL)과 스케줄러 배치(발생/소멸/촉진)를 등록한다.
 */
@Module({
  imports: [ApprovalModule, PolicyModule, SchedulerModule],
  controllers: [LeavesController],
  providers: [LeavesService],
  exports: [LeavesService],
})
export class LeaveModule implements OnModuleInit {
  constructor(
    private readonly approval: ApprovalService,
    private readonly scheduler: SchedulerService,
    private readonly leaves: LeavesService,
  ) {}

  onModuleInit() {
    this.approval.registerHooks('LEAVE', {
      onApproved: (id) => this.leaves.applyLeave(id),
      onRejected: (id) => this.leaves.rejectLeave(id),
    });
    this.approval.registerHooks('LEAVE_CANCEL', {
      onApproved: (id) => this.leaves.applyCancel(id),
      onRejected: (id) => this.leaves.rejectCancel(id),
    });

    this.scheduler.registerHandler('leave-grant', async () => ({
      processedCount: await this.leaves.runGrantBatch(),
    }));
    this.scheduler.registerHandler('leave-expire', async () => ({
      processedCount: await this.leaves.runExpireBatch(),
    }));
    this.scheduler.registerHandler('leave-promotion-alert', async () => ({
      processedCount: await this.leaves.runPromotionBatch(),
    }));
  }
}
