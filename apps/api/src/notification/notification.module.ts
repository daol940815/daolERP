import { Global, Module, OnModuleInit } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SchedulerService } from '../scheduler/scheduler.service';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';

/**
 * 알림 모듈 — ERP Core Service (기획서 5.5).
 * @Global: 승인/휴가/근태 등 전 모듈이 발행자로 사용.
 */
@Global()
@Module({
  imports: [SchedulerModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    this.scheduler.registerHandler('notification-dispatch', async () => ({
      processedCount: await this.notifications.dispatch(),
    }));
  }
}
