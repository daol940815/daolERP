import { createAdminClient, createClient } from '@/lib/supabase-server'

// 로그인 사용자의 역할 판정.
//  - employees.auth_user_id 로 연결된 직원이 있으면 그 role을 따른다.
//  - 연결된 직원이 없으면 'admin' — 기존 관리자 계정(직원 등록 이전부터 사용)과
//    103 마이그레이션 미적용 환경의 하위 호환. 신규 계정은 전부 관리자가
//    직원 등록을 통해서만 발급되므로 임의 가입으로 admin이 되는 경로는 없다.
//
// 등급:
//   sales   — 주문 관리 (본인 업무 중심)
//   manager — 주문 관리 + 관리자 기능(수정·삭제 승인). 회계·경영 모드 접근 불가
//   admin   — 전체 접근
export type UserRole = 'sales' | 'manager' | 'admin'

// ID 로그인용 내부 도메인 — 화면에는 ID만 노출하고 인증은 이 이메일로 처리
export const LOGIN_ID_DOMAIN = 'daol.internal'
export const loginIdToEmail = (loginId: string) => `${loginId.trim().toLowerCase()}@${LOGIN_ID_DOMAIN}`

export interface CurrentUser {
  userId: string
  email: string | null
  role: UserRole
  employeeId: string | null
  employeeName: string | null
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return null

    const admin = createAdminClient()
    const { data: emp, error } = await admin
      .from('employees')
      .select('id, name, role, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    // 103 미적용(컬럼 없음) 등 조회 실패 → admin 폴백
    if (error || !emp) {
      return { userId: user.id, email: user.email ?? null, role: 'admin', employeeId: null, employeeName: null }
    }
    const role: UserRole = emp.is_active
      ? ((emp.role === 'admin' || emp.role === 'manager') ? emp.role : 'sales')
      : 'sales'
    return {
      userId: user.id,
      email: user.email ?? null,
      role,
      employeeId: emp.id as string,
      employeeName: emp.name as string,
    }
  } catch {
    return null
  }
}
