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

/** 기능 단위 권한 액션 (기획서 3.3) */
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
  // M2 — 정책 관리
  'policy.read',
  'policy.manage',
  // M3 — 근무일정 / 승인
  'schedule.read',
  'schedule.manage',
  'approval.manage', // 승인라인 정의/배정
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

// ── M2 정책 도메인 ─────────────────────────────────────────────

/** 근무정책 유형 (기획서 4.2) */
export const WORK_POLICY_TYPES = ['FIXED', 'FLEX', 'AUTONOMOUS'] as const;
export type WorkPolicyType = (typeof WORK_POLICY_TYPES)[number];

/** 연차 부여 기준 (#1 입사일 확정, 회계연도 구조 지원) */
export const LEAVE_GRANT_BASIS = ['HIRE_DATE', 'FISCAL_YEAR'] as const;
export type LeaveGrantBasis = (typeof LEAVE_GRANT_BASIS)[number];

/** 휴가 유급 유형 (기획서 4.5.1) */
export const LEAVE_PAID_TYPES = ['PAID', 'UNPAID', 'POLICY'] as const;
export type LeavePaidType = (typeof LEAVE_PAID_TYPES)[number];

/** 첨부파일 요구 규칙 (기획서 4.5.1 / 4.8) */
export const ATTACHMENT_RULES = ['NONE', 'OPTIONAL', 'REQUIRED'] as const;
export type AttachmentRule = (typeof ATTACHMENT_RULES)[number];

/** 휴일 유형 (기획서 4.9) */
export const HOLIDAY_TYPES = [
  'STATUTORY', // 법정공휴일
  'SUBSTITUTE', // 대체공휴일
  'FOUNDATION', // 회사창립기념일
  'COMPANY', // 회사지정휴무
  'TEMPORARY', // 임시휴무
] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

/** 정책 배정 출처 — resolve 결과가 어디서 왔는지 (개인/부서/전사 기본값) */
export const POLICY_SOURCES = ['EMPLOYEE', 'DEPARTMENT', 'DEFAULT', 'NONE'] as const;
export type PolicySource = (typeof POLICY_SOURCES)[number];

// ── M3 근무일정 / 승인 도메인 ──────────────────────────────────

/** 근무일정 생성 근거 (기획서 4.3) */
export const SCHEDULE_SOURCES = ['AUTO', 'MANUAL'] as const;
export type ScheduleSource = (typeof SCHEDULE_SOURCES)[number];

/** 신청 유형 — 승인이 공통 처리 (기획서 4.7) */
export const REQUEST_TYPES = ['LEAVE', 'OVERTIME', 'ATTENDANCE_CORRECTION'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** 승인 단계의 승인자 지정 방식 (기획서 APV-02) */
export const APPROVER_TYPES = ['SPECIFIC', 'DEPT_HEAD', 'PARENT_DEPT_HEAD', 'JOB_TITLE'] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

/** 승인 인스턴스 상태 (기획서 5.3) */
export const APPROVAL_STATUS = ['IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS)[number];

/** 단계 처리 결과 */
export const STEP_DECISIONS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type StepDecision = (typeof STEP_DECISIONS)[number];

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
