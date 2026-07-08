import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateWorkPolicyDto, AddWorkPolicyVersionDto } from './work-policies.dto';

@Injectable()
export class WorkPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.workPolicy.findMany({
      orderBy: { id: 'asc' },
      include: {
        versions: { orderBy: { effectiveDate: 'desc' } },
        _count: { select: { employees: true, departments: true } },
      },
    });
  }

  async findOne(id: number) {
    const policy = await this.prisma.workPolicy.findUnique({
      where: { id },
      include: { versions: { orderBy: { effectiveDate: 'desc' } } },
    });
    if (!policy) throw new NotFoundException('근무정책을 찾을 수 없습니다.');
    return policy;
  }

  /**
   * 특정 일자에 유효한 버전 = effectiveDate <= date 중 가장 최근 (기획서 5.1).
   * 근태 엔진이 소급 계산 시 이 로직을 사용한다.
   */
  async getEffectiveVersion(policyId: number, date: Date) {
    return this.prisma.workPolicyVersion.findFirst({
      where: { workPolicyId: policyId, effectiveDate: { lte: date } },
      orderBy: { effectiveDate: 'desc' },
    });
  }

  async create(dto: CreateWorkPolicyDto, actor: { userId: number; ip?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.workPolicy.create({
        data: { name: dto.name, type: dto.type },
      });
      // 최초 버전 동시 생성 (정책은 최소 1개 버전을 가져야 의미가 있음)
      await tx.workPolicyVersion.create({
        data: {
          workPolicyId: created.id,
          effectiveDate: new Date(dto.version.effectiveDate),
          startTime: dto.version.startTime ?? null,
          endTime: dto.version.endTime ?? null,
          breakMinutes: dto.version.breakMinutes ?? 60,
          standardWorkMinutes: dto.version.standardWorkMinutes ?? 480,
          lateGraceMinutes: dto.version.lateGraceMinutes ?? 0,
          flexStartFrom: dto.version.flexStartFrom ?? null,
          flexStartTo: dto.version.flexStartTo ?? null,
          ipRestricted: dto.version.ipRestricted ?? false,
          reason: dto.version.reason ?? '정책 신규 등록',
          createdBy: actor.userId,
        },
      });
      await this.audit.log(
        {
          targetType: 'work_policy',
          targetId: created.id,
          action: 'CREATE',
          after: created,
          reason: dto.version.reason ?? '근무정책 등록',
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return created;
    });
  }

  /** 버전 추가 — 정책 변경은 새 버전으로 (과거 근태는 당시 버전으로 계산. 기획서 POL-03) */
  async addVersion(
    policyId: number,
    dto: AddWorkPolicyVersionDto,
    actor: { userId: number; ip?: string },
  ) {
    const policy = await this.prisma.workPolicy.findUnique({ where: { id: policyId } });
    if (!policy) throw new NotFoundException('근무정책을 찾을 수 없습니다.');
    const dup = await this.prisma.workPolicyVersion.findUnique({
      where: { workPolicyId_effectiveDate: {
        workPolicyId: policyId,
        effectiveDate: new Date(dto.effectiveDate),
      } },
    });
    if (dup) throw new BadRequestException('해당 적용 시작일의 버전이 이미 존재합니다.');

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.workPolicyVersion.create({
        data: {
          workPolicyId: policyId,
          effectiveDate: new Date(dto.effectiveDate),
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          breakMinutes: dto.breakMinutes ?? 60,
          standardWorkMinutes: dto.standardWorkMinutes ?? 480,
          lateGraceMinutes: dto.lateGraceMinutes ?? 0,
          flexStartFrom: dto.flexStartFrom ?? null,
          flexStartTo: dto.flexStartTo ?? null,
          ipRestricted: dto.ipRestricted ?? false,
          reason: dto.reason,
          createdBy: actor.userId,
        },
      });
      await this.audit.log(
        {
          targetType: 'work_policy_version',
          targetId: version.id,
          action: 'CREATE',
          after: version,
          reason: dto.reason,
          actorUserId: actor.userId,
          ip: actor.ip,
        },
        tx,
      );
      return version;
    });
  }
}
