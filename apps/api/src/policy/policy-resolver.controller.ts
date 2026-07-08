import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.decorator';
import { PolicyResolverService } from './policy-resolver.service';

/** 직원별 유효 정책 조회 — 화면에서 "이 직원에게 실제 적용되는 정책"과 출처를 보여줌 */
@Controller('employees/:id/effective-policies')
export class PolicyResolverController {
  constructor(private readonly resolver: PolicyResolverService) {}

  @Get()
  @RequirePermission('policy.read')
  async resolve(@Param('id', ParseIntPipe) id: number) {
    const [work, leave] = await Promise.all([
      this.resolver.resolveWorkPolicy(id),
      this.resolver.resolveLeavePolicy(id),
    ]);
    return { work, leave };
  }
}
