import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { MeResponse } from '@daolerp/shared';

/** 인증 컨텍스트의 사용자 — JwtStrategy.validate 의 반환값 */
export type AuthUser = MeResponse;

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
