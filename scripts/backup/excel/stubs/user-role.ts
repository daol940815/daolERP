// 백업용 엑셀 만들기 전용: 로그인 대신 "백업 계정(마스터 권한)"으로 앱 내보내기를 돌린다.
// 앱 코드는 고치지 않는다 — 묶을 때(build.mjs) '@/lib/user-role' 를 이 파일로 바꿔 끼운다.
// 나머지 내보내기(형 · 상수 · 함수)는 원래 파일 그대로 쓴다(이름이 같으면 이 파일 것이 우선).
export * from '__REAL_USER_ROLE__'
import type { CurrentUser } from '__REAL_USER_ROLE__'

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return {
    userId: 'backup-export',
    email: null,
    role: 'admin',
    employeeId: null,
    employeeName: null,
    team: null,
    employmentType: 'regular',
    workEnd: null,
    isMaster: true,
    permissions: {},
    canApprove: true,
    canViewSalary: true,
    canViewPaymentInfo: true,
  } as unknown as CurrentUser
}
