import { Injectable, NotFoundException } from '@nestjs/common';
import type { PolicySource } from '@daolerp/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedPolicy<T> {
  source: PolicySource; // EMPLOYEE | DEPARTMENT | DEFAULT | NONE
  policyId: number | null;
  policy: T | null;
}

/**
 * 정책 배정 해석기 — 우선순위: 직원 개인 > 부서 > 전사 기본값 (기획서 4.1.1).
 * M3(근무일정 생성)·M4(근태 엔진)·M5(연차 발생)가 이 서비스로 유효 정책을 얻는다.
 * 여기서 "정책 배정"만 해석하고, 정책 버전(일자별)은 WorkPoliciesService.getEffectiveVersion 이 담당.
 */
@Injectable()
export class PolicyResolverService {
  constructor(private readonly prisma: PrismaService) {}

  private async defaultPolicyId(settingKey: string): Promise<number | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: settingKey } });
    const v = row?.value;
    return typeof v === 'number' && v > 0 ? v : null;
  }

  /** 직원의 유효 근무정책 (배정만 해석 — 버전은 별도) */
  async resolveWorkPolicy(employeeId: number): Promise<ResolvedPolicy<unknown>> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { workPolicy: true, department: { include: { workPolicy: true } } },
    });
    if (!emp) throw new NotFoundException('직원을 찾을 수 없습니다.');

    if (emp.workPolicyId && emp.workPolicy)
      return { source: 'EMPLOYEE', policyId: emp.workPolicyId, policy: emp.workPolicy };
    if (emp.department?.workPolicyId && emp.department.workPolicy)
      return {
        source: 'DEPARTMENT',
        policyId: emp.department.workPolicyId,
        policy: emp.department.workPolicy,
      };
    const defId = await this.defaultPolicyId('policy.defaultWorkPolicyId');
    if (defId) {
      const policy = await this.prisma.workPolicy.findUnique({ where: { id: defId } });
      if (policy) return { source: 'DEFAULT', policyId: defId, policy };
    }
    return { source: 'NONE', policyId: null, policy: null };
  }

  /** 직원의 유효 연차정책 */
  async resolveLeavePolicy(employeeId: number): Promise<ResolvedPolicy<unknown>> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { leavePolicy: true, department: { include: { leavePolicy: true } } },
    });
    if (!emp) throw new NotFoundException('직원을 찾을 수 없습니다.');

    if (emp.leavePolicyId && emp.leavePolicy)
      return { source: 'EMPLOYEE', policyId: emp.leavePolicyId, policy: emp.leavePolicy };
    if (emp.department?.leavePolicyId && emp.department.leavePolicy)
      return {
        source: 'DEPARTMENT',
        policyId: emp.department.leavePolicyId,
        policy: emp.department.leavePolicy,
      };
    const defId = await this.defaultPolicyId('policy.defaultLeavePolicyId');
    if (defId) {
      const policy = await this.prisma.leavePolicy.findUnique({ where: { id: defId } });
      if (policy) return { source: 'DEFAULT', policyId: defId, policy };
    }
    return { source: 'NONE', policyId: null, policy: null };
  }
}
