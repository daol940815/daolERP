import { createAdminClient, createClient } from '@/lib/supabase-server'

// 로그인 사용자의 역할 판정.
//  - employees.auth_user_id 로 연결된 직원이 있으면 그 role을 따른다.
//  - 연결된 직원이 없으면 'admin' — 기존 관리자 계정(직원 등록 이전부터 사용)과
//    103 마이그레이션 미적용 환경의 하위 호환. 신규 계정은 전부 관리자가
//    직원 등록을 통해서만 발급되므로 임의 가입으로 admin이 되는 경로는 없다.
export type UserRole = 'sales' | 'admin'

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
    return {
      userId: user.id,
      email: user.email ?? null,
      role: (emp.is_active ? (emp.role as UserRole) : 'sales'),
      employeeId: emp.id as string,
      employeeName: emp.name as string,
    }
  } catch {
    return null
  }
}
