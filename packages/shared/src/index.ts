// @daolerp/shared — API와 Web이 공유하는 타입/상수.
// 규약: 여기에는 순수 타입·상수만 둔다 (런타임 의존성 금지).

/** 직원 재직 상태 */
export const EMPLOYEE_STATUS = ['ACTIVE', 'RESIGNING', 'RESIGNED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUS)[number];

/** 직원 변경 이력 유형 (기획서 4.1.2) */
export const EMPLOYEE_CHANGE_TYPES = [
  'DEPARTMENT',
  'JOB_GRADE',
  'JOB_TITLE',
  'EMPLOYMENT_TYPE',
  'WORK_TYPE',
  'STATUS',
] as const;
export type EmployeeChangeType = (typeof EMPLOYEE_CHANGE_TYPES)[number];

/** 권한 스코프 — 권한 문자열에 굳히지 않고 분리 (기획서 3.3) */
export const PERMISSION_SCOPES = ['SELF', 'DEPT', 'ALL'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** 기능 단위 권한 액션 (기획서 3.3 — M1 범위) */
export const PERMISSION_ACTIONS = [
  'employee.read',
  'employee.manage',
  'department.manage',
  'user.manage',
  'code.manage',
  'settings.manage',
  'scheduler.read',
  'scheduler.execute',
  'audit.read',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** 역할 코드 (기획서 3.2) */
export const ROLE_CODES = ['EMPLOYEE', 'APPROVER', 'HR', 'ADMIN'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** 공통 코드 그룹 (기획서 5.1 — 속성 없는 열거값만) */
export const CODE_GROUPS = ['WORK_TYPE'] as const;
export type CodeGroup = (typeof CODE_GROUPS)[number];

/** 접속 로그 이벤트 (기획서 6장 접속 기록) */
export const ACCESS_EVENTS = ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PII_READ'] as const;
export type AccessEvent = (typeof ACCESS_EVENTS)[number];

/** 스케줄러 실행 상태 */
export const JOB_RUN_STATUS = ['RUNNING', 'SUCCESS', 'FAILED'] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUS)[number];

/** 로그인 응답 */
export interface LoginResponse {
  accessToken: string;
  user: MeResponse;
}

/** 내 정보 응답 */
export interface MeResponse {
  id: number;
  email: string;
  employee: {
    id: number;
    empNo: string;
    name: string;
    departmentId: number | null;
    departmentName: string | null;
  } | null;
  roles: RoleCode[];
  permissions: { action: string; scope: PermissionScope }[];
}
