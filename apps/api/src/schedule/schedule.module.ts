import { Module, OnModuleInit } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SchedulerService } from '../scheduler/scheduler.service';
import { WorkSchedulesService } from './work-schedules.service';
import { WorkSchedulesController } from './work-schedules.controller';

/**
 * 근무일정 모듈 [Master] (기획서 4.3).
 * 스케줄러 작업 'work-schedule-generate' 핸들러를 등록 — 익월분 자동 생성.
 */
@Module({
  imports: [PolicyModule, SchedulerModule],
  controllers: [WorkSchedulesController],
  providers: [WorkSchedulesService],
  exports: [WorkSchedulesService],
})
export class ScheduleModule implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly workSchedules: WorkSchedulesService,
  ) {}

  onModuleInit() {
    // 매월 말 실행 → 익월분 생성 (멱등: 이미 있으면 update, MANUAL 보존)
    this.scheduler.registerHandler('work-schedule-generate', async () => {
      const now = new Date();
      // 익월 계산
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const results = await this.workSchedules.generateAllForMonth(
        target.getUTCFullYear(),
        target.getUTCMonth() + 1,
      );
      const processed = results.reduce((s, r) => s + r.created + r.updated, 0);
      return { processedCount: processed };
    });
  }
}
