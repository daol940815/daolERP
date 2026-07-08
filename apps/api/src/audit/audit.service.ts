import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  targetType: string;
  targetId: string | number;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  before?: unknown;
  after?: unknown;
  reason: string; // 사유 필수 (기획서 6장)
  actorUserId?: number;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 트랜잭션 안에서 함께 기록할 수 있도록 tx 를 받는다 */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        targetType: entry.targetType,
        targetId: String(entry.targetId),
        action: entry.action,
        beforeValue: entry.before === undefined ? undefined : (entry.before as Prisma.InputJsonValue),
        afterValue: entry.after === undefined ? undefined : (entry.after as Prisma.InputJsonValue),
        reason: entry.reason,
        actorUserId: entry.actorUserId,
        ip: entry.ip,
      },
    });
  }

  list(params: { targetType?: string; targetId?: string; take?: number; skip?: number }) {
    return this.prisma.auditLog.findMany({
      where: {
        targetType: params.targetType,
        targetId: params.targetId,
      },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 50,
      skip: params.skip ?? 0,
      include: { actor: { select: { id: true, email: true } } },
    });
  }

  listAccess(params: { userId?: number; take?: number; skip?: number }) {
    return this.prisma.accessLog.findMany({
      where: { userId: params.userId },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 50,
      skip: params.skip ?? 0,
      include: { user: { select: { id: true, email: true } } },
    });
  }
}
