import { Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.decorator';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('jobs')
  @RequirePermission('scheduler.read')
  listJobs() {
    return this.scheduler.listJobs();
  }

  @Get('jobs/:id/runs')
  @RequirePermission('scheduler.read')
  listRuns(@Param('id', ParseIntPipe) id: number) {
    return this.scheduler.listRuns(id);
  }

  @Post('jobs/:id/run')
  @RequirePermission('scheduler.execute')
  async run(@Param('id', ParseIntPipe) id: number) {
    const job = await this.prisma.schedulerJob.findUniqueOrThrow({ where: { id } });
    const runId = await this.scheduler.execute(job.name, 'MANUAL');
    return { runId };
  }
}
