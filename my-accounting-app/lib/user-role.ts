import { createAdminClient, createClient } from '@/lib/supabase-server'
import type { Permissions, PermSubject } from '@/lib/permissions'

// 로그인 사용자의 역할·권한 판정.
//  - employees.auth_user_id 로 연결된 직원이 있으면 그 role·permissions를 따른다.
//  - 연결된 직원이 없으면 'admin' — 기존 관리자 계정(직원 등록 이전부터 사용)과
//    103 마이그레이션 미적용 환경의 하위 호환. 신규 계정은 전부 관리자가
//    직원 등록을 통해서만 발급되므로 임의 가입으로 admin이 되는 경로는 없다.
//  - 109 적용 후에는 permissions(그룹별 없음/조회/수정)·is_master가 1차 기준이고,
//    role은 109 미적용 환경 폴백(lib/permissions.ts levelOf 참조).
//
// 등급(레거시):
//   sales   — 주문 관리 (본인 업무 중심)
//   manager — 주문 관리 + 관리자 기능(수정·삭제 승인). 회계·경영 모드 접근 불가
//   admin   — 전체 접근
export type UserRole = 'sales' | 'manager' | 'admin'

// ID 로그인용 내부 도메인 — 화면에는 ID만 노출하고 인증은 이 이메일로 처리
export const LOGIN_ID_DOMAIN = 'daol.internal'
export const loginIdToEmail = (loginId: string) => `${loginId.trim().toLowerCase()}@${LOGIN_ID_DOMAIN}`

export interface CurrentUser extends PermSubject {
  userId: string
  email: string | null
  role: UserRole
  employeeId: string | null
  employeeName: string | null
  team: string | null
  employmentType: 'regular' | 'parttime'
  workEnd: string | null
  canViewSalary: boolean
  canViewPaymentInfo: boolean
}

const PERM_COLS = 'id, name, role, is_active, team, employment_type, work_end, is_master, permissions, can_approve, can_view_salary, can_view_payment_info'
const LEGACY_COLS = 'id, name, role, is_active'

const adminFallback = (userId: string, email: string | null): CurrentUser => ({
  userId, email, role: 'admin', employeeId: null, employeeName: null,
  team: null, employmentType: 'regular', workEnd: null,
  isMaster: false, permissions: {}, canApprove: false, canViewSalary: false, canViewPaymentInfo: false,
})

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return null

    const admin = createAdminClient()
    // 109 적용 컬럼으로 먼저 조회, 컬럼이 없으면(미적용) 레거시 컬럼으로 재조회
    let r = await admin.from('employees').select(PERM_COLS).eq('auth_user_id', user.id).maybeSingle()
    if (r.error) {
      r = await admin.from('employees').select(LEGACY_COLS).eq('auth_user_id', user.id).maybeSingle() as typeof r
    }
    const emp = r.data as Record<string, unknown> | null

    // 조회 실패·미연결 → admin 폴백 (기존 관리자 계정 호환)
    if (r.error || !emp) return adminFallback(user.id, user.email ?? null)

    const isActive = emp.is_active !== false
    const role: UserRole = isActive
      ? ((emp.role === 'admin' || emp.role === 'manager') ? (emp.role as UserRole) : 'sales')
      : 'sales'
    const workEnd = (emp.work_end as string | null) ?? null
    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    // 비활성 또는 아르바이트 근무 종료일 경과 → 전 영역 차단 (레이아웃에서 로그인 화면으로)
    const expired = !isActive || (workEnd !== null && workEnd < todayKst)

    return {
      userId: user.id,
      email: user.email ?? null,
      role,
      employeeId: emp.id as string,
      employeeName: emp.name as string,
      team: (emp.team as string | null) ?? null,
      employmentType: emp.employment_type === 'parttime' ? 'parttime' : 'regular',
      workEnd,
      isMaster: emp.is_master === true && !expired,
      permissions: (emp.permissions as Permissions | null) ?? {},
      canApprove: emp.can_approve === true,
      canViewSalary: emp.can_view_salary === true,
      canViewPaymentInfo: emp.can_view_payment_info === true,
      expired,
    }
  } catch {
    return null
  }
}
