import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'
import LogoutButton from './logout-button'

export const dynamic = 'force-dynamic'

// 로그인 후 모드 선택 — admin 전용 (B안: 직원 단일 워크스페이스)
// 일반 직원·중간 관리자는 선택 화면 없이 워크스페이스(내 대시보드)로 직행한다.
export default async function PortalPage() {
  const me = await getCurrentUser()
  if (!me) redirect('/login')
  if (me.role !== 'admin') redirect('/me')

  const name = me.employeeName ?? me.email ?? '사용자'

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
      <h1 className="text-white text-xl font-bold">다올커머스 업무 시스템</h1>
      <p className="text-slate-400 text-sm mt-2">{name}님, 어떤 업무로 들어가시겠어요?</p>

      <div className="flex gap-4 mt-8 flex-wrap justify-center">
        <Link href="/me"
          className="block bg-white rounded-2xl p-7 w-64 hover:-translate-y-0.5 hover:shadow-xl transition-all">
          <div className="text-base font-bold text-slate-900">직원 워크스페이스</div>
          <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            대시보드 · 주문 현황<br />근태 · 휴가 · 영업일지
          </div>
          <div className="mt-4 inline-block px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-semibold">
            들어가기
          </div>
        </Link>

        <Link href="/hr"
          className="block bg-white rounded-2xl p-7 w-64 hover:-translate-y-0.5 hover:shadow-xl transition-all">
          <div className="text-base font-bold text-slate-900">직원 관리</div>
          <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            출퇴근 체크 · 휴가 신청<br />휴가 승인 · 근태 현황 (관리자)
          </div>
          <div className="mt-4 inline-block px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-semibold">
            들어가기
          </div>
        </Link>

        <Link href="/"
          className="block bg-white rounded-2xl p-7 w-64 hover:-translate-y-0.5 hover:shadow-xl transition-all">
          <div className="text-base font-bold text-slate-900">회계 · 경영 관리</div>
          <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            매출처 허브 · 회계 장부<br />경영대시보드 · 정리 도구
          </div>
          <div className="mt-4 inline-block px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-semibold">
            들어가기
          </div>
        </Link>
      </div>

      <p className="text-slate-600 text-[11px] mt-10">역할: 전체 관리자</p>
      <div className="mt-4">
        <LogoutButton />
      </div>
    </div>
  )
}
