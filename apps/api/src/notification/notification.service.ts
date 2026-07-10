import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { renderTemplate } from './notification.templates';

const MAX_RETRIES = 3;

/**
 * 알림 모듈 — ERP Core Service (기획서 5.5).
 * publish(발행)는 업무 트랜잭션과 동일 tx 에 아웃박스 기록 → 알림 유실 없음.
 * dispatch(발송)는 스케줄러가 큐를 폴링 → 채널 어댑터 → 실패 재시도(MAX 초과 시 DEAD).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 발행 — userId 대상. 기본 채널: 시스템 내 알림(INAPP) */
  async publish(
    userIds: number[],
    template: string,
    params: Record<string, string | number>,
    tx?: Prisma.TransactionClient,
    channels: string[] = ['INAPP'],
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const rows = userIds.flatMap((userId) =>
      channels.map((channel) => ({ userId, channel, template, params })),
    );
    if (rows.length > 0) await db.notificationOutbox.createMany({ data: rows });
  }

  /** employeeId → userId 변환 발행 (승인 등 직원 기반 이벤트용). 계정 없는 직원은 스킵 */
  async publishToEmployees(
    employeeIds: number[],
    template: string,
    params: Record<string, string | number>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const users = await db.user.findMany({
      where: { employeeId: { in: employeeIds }, isActive: true },
      select: { id: true },
    });
    await this.publish(users.map((u) => u.id), template, params, tx);
  }

  /** 발송 — 스케줄러 'notification-dispatch' 핸들러가 호출 */
  async dispatch(batchSize = 100): Promise<number> {
    const pending = await this.prisma.notificationOutbox.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let sent = 0;
    for (const item of pending) {
      try {
        await this.sendViaChannel(item.channel, item.userId, item.template, item.params as never);
        await this.prisma.notificationOutbox.update({
          where: { id: item.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        sent++;
      } catch (e) {
        const retryCount = item.retryCount + 1;
        await this.prisma.notificationOutbox.update({
          where: { id: item.id },
          data: {
            status: retryCount >= MAX_RETRIES ? 'DEAD' : 'FAILED',
            retryCount,
            lastError: (e as Error).message,
          },
        });
      }
    }
    return sent;
  }

  /** 채널 어댑터 — Slack/카카오워크/SMS 는 여기에 어댑터 추가 (업무 코드 무변경. 기획서 5.5) */
  private async sendViaChannel(
    channel: string,
    userId: number,
    template: string,
    params: Record<string, string | number>,
  ): Promise<void> {
    const rendered = renderTemplate(template, params);
    switch (channel) {
      case 'INAPP':
        await this.prisma.notification.create({
          data: { userId, title: rendered.title, body: rendered.body, link: rendered.link },
        });
        return;
      case 'EMAIL': {
        // SMTP 설정(system_settings mail.*)이 비어 있으면 스킵 (설정 후 실발송 어댑터 연결)
        const host = await this.prisma.systemSetting.findUnique({ where: { key: 'mail.smtpHost' } });
        if (!host?.value) {
          this.logger.warn(`EMAIL 채널 미설정 — 스킵 (user ${userId}, ${template})`);
          return;
        }
        // TODO: nodemailer 연결 (운영 SMTP 확정 후)
        return;
      }
      default:
        throw new Error(`알 수 없는 채널: ${channel}`);
    }
  }

  // ── 수신함 ──
  list(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  unreadCount(userId: number) {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: number, userId: number) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    return { ok: true };
  }

  async markAllRead(userId: number) {
    await this.prisma.notification.updateMany({ where: { userId }, data: { isRead: true } });
    return { ok: true };
  }
}
