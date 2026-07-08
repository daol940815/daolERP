import { SetMetadata } from '@nestjs/common';
import type { PermissionAction } from '@daolerp/shared';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * 기능 단위 권한 요구 (기획서 3.3).
 * 스코프는 지정하지 않는다 — 가드는 "해당 action 을 어떤 스코프로든 보유"를 확인하고,
 * 데이터 범위 제한은 각 서비스가 보유 스코프(SELF/DEPT/ALL)로 필터링한다.
 */
export const RequirePermission = (action: PermissionAction) =>
  SetMetadata(PERMISSION_KEY, action);
