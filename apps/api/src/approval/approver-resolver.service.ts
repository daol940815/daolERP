import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 승인 단계의 실제 승인자를 신청자 기준으로 해석 (기획서 APV-02).
 * 인스턴스 생성 시점에 단계별로 호출되어 approverEmployeeId 를 확정한다.
 */
@Injectable()
export class ApproverResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    step: {
      approverType: string;
      approverEmployeeId: number | null;
      approverJobTitleCode: string | null;
    },
    applicantEmployeeId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number | null> {
    const db = tx ?? this.prisma;
    switch (step.approverType) {
      case 'SPECIFIC':
        return step.approverEmployeeId ?? null;

      case 'DEPT_HEAD': {
        const emp = await db.employee.findUnique({
          where: { id: applicantEmployeeId },
          include: { department: true },
        });
        return emp?.department?.headEmployeeId ?? null;
      }

      case 'PARENT_DEPT_HEAD': {
        const emp = await db.employee.findUnique({
          where: { id: applicantEmployeeId },
          include: { department: { include: { parent: true } } },
        });
        return emp?.department?.parent?.headEmployeeId ?? null;
      }

      case 'JOB_TITLE': {
        if (!step.approverJobTitleCode) return null;
        // 해당 직책 보유자 중 첫 번째 (동명 다수 시 정책 확정 필요 — 골격)
        const holder = await db.employee.findFirst({
          where: { jobTitleCode: step.approverJobTitleCode, status: 'ACTIVE' },
          orderBy: { id: 'asc' },
        });
        return holder?.id ?? null;
      }

      default:
        return null;
    }
  }
}
