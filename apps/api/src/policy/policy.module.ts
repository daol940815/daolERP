import { Module } from '@nestjs/common';
import { WorkPoliciesController } from './work-policies.controller';
import { WorkPoliciesService } from './work-policies.service';
import { LeavePoliciesController } from './leave-policies.controller';
import { LeavePoliciesService } from './leave-policies.service';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { PolicyResolverService } from './policy-resolver.service';
import { PolicyResolverController } from './policy-resolver.controller';

/**
 * 정책 모듈 [Master] — 근무정책/연차정책/휴가유형/휴일 (기획서 4.2/4.5/4.9).
 * PolicyResolverService 는 배정 우선순위(개인>부서>전사)를 해석하며,
 * M3(근무일정 생성)·M4(근태 엔진)가 이 서비스를 통해 유효 정책을 얻는다.
 */
@Module({
  controllers: [
    WorkPoliciesController,
    LeavePoliciesController,
    LeaveTypesController,
    HolidaysController,
    PolicyResolverController,
  ],
  providers: [
    WorkPoliciesService,
    LeavePoliciesService,
    LeaveTypesService,
    HolidaysService,
    PolicyResolverService,
  ],
  exports: [WorkPoliciesService, PolicyResolverService, HolidaysService],
})
export class PolicyModule {}
