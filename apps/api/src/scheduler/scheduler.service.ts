import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 공통 스케줄러 — ERP Core Service (기획서 5.4).
 * 이 모듈은 도메인 지식을 갖지 않는다: 작업 정의(scheduler_jobs)와 실행 이력만 관리하고,
 * 실제 작업 내용은 각 도메인 모듈이 registerHandler() 로 등록한다.
 * 핸들러는 멱등하게 구현할 것 (같은 날 두 번 실행돼도 중복 효과 없음).
 */
export type JobHandler = () => Promise<{ processedCount: number }>;

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly handlers = new Map<string, JobHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SchedulerRegistry,
  ) {}

  registerHandler(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
  }

  /** 기동 시 DB의 활성 작업을 cron 으로 등록 */
  async onModuleInit(): Promise<void> {
    const jobs = await this.prisma.schedulerJob.findMany({ where: { isActive: true } });
    for (const job of jobs) {
      try {
        const cronJob = new CronJob(job.cron, () => void this.execute(job.name, 'SCHEDULE'));
        this.registry.addCronJob(job.name, cronJob);
        cronJob.start();
        this.logger.log(`작업 등록: ${job.name} (${job.cron})`);
      } catch (e) {
        this.logger.error(`작업 등록 실패: ${job.name} — ${(e as Error).message}`);
      }
    }
  }

  /** 작업 실행 + 실행 이력 기록. 수동 실행(MANUAL)도 동일 경로 */
  async execute(jobName: string, triggeredBy: 'SCHEDULE' | 'MANUAL'): Promise<number> {
    const job = await this.prisma.schedulerJob.findUnique({ where: { name: jobName } });
    if (!job) throw new NotFoundException(`작업을 찾을 수 없습니다: ${jobName}`);

    const run = await this.prisma.schedulerJobRun.create({
      data: { jobId: job.id, triggeredBy },
    });

    const handler = this.handlers.get(jobName);
    try {
      if (!handler) throw new Error('핸들러가 등록되지 않았습니다 (구현 예정 작업)');
      const result = await handler();
      await this.prisma.schedulerJobRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          processedCount: result.processedCount,
        },
      });
    } catch (e) {
      await this.prisma.schedulerJobRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: (e as Error).message },
      });
      this.logger.error(`작업 실패: ${jobName} — ${(e as Error).message}`);
    }
    return run.id;
  }

  listJobs() {
    return this.prisma.schedulerJob.findMany({
      orderBy: { name: 'asc' },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
  }

  listRuns(jobId: number, take = 20) {
    return this.prisma.schedulerJobRun.findMany({
      where: { jobId },
      orderBy: { startedAt: 'desc' },
      take,
    });
  }
}
