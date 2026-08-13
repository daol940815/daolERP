import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser, type CurrentUser } from '@/lib/user-role'

// 로그인 계정에 대응하는 직원 행을 보장한다.
// 직원 등록 기능 이전부터 쓰던 관리자 계정처럼 employees와 연결되지 않은 계정도
// 별도 절차 없이 근태를 쓸 수 있도록, 같은 이름의 계정 미발급 직원이 있으면 그 행에
// 연결하고 없으면 새로 만든다. 등급과 무관하게 모든 로그인 계정이 대상.

export type EmployeeCtx =
  | { me: CurrentUser; employeeId: string; admin: ReturnType<typeof createAdminClient> }
  | { error: string; status: 401 | 500 }

export async function getAttendanceEmployee(): Promise<EmployeeCtx> {
  const me = await getCurrentUser()
  if (!me) return { error: '로그인이 필요합니다.', status: 401 }

  const admin = createAdminClient()
  if (me.employeeId) return { me, employeeId: me.employeeId, admin }

  // 계정 이메일 앞부분을 임시 이름으로 사용 (직원·계정 관리에서 언제든 수정 가능)
  const name = (me.email ?? '').split('@')[0].trim() || '이름 미지정'
  const { data: exist } = await admin.from('employees')
    .select('id').eq('name', name).is('auth_user_id', null).eq('is_active', true).maybeSingle()

  if (exist) {
    const { error } = await admin.from('employees')
      .update({ auth_user_id: me.userId, is_active: true, attendance_target: true })
      .eq('id', exist.id)
    if (error) return { error: error.message, status: 500 }
    return { me: { ...me, employeeId: exist.id as string }, employeeId: exist.id as string, admin }
  }

  const { data: created, error } = await admin.from('employees')
    .insert({
      name, email: me.email, auth_user_id: me.userId,
      role: me.role, is_active: true, attendance_target: true,
    })
    .select('id').single()
  if (error) return { error: error.message, status: 500 }
  return { me: { ...me, employeeId: created.id as string }, employeeId: created.id as string, admin }
}
