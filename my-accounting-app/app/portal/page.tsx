import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 로그인 후 모드 선택 — 주문 관리 / 회계·경영 관리
// 역할이 sales면 회계·경영 카드는 비활성으로 표시된다.
export default async function PortalPage() {
  const me = await getCurrentUser()
  if (!me) redirect('/login')

  const isAdmin = me.role === 'admin'
  const name = me.employeeName ?? me.email ?? '사용자'

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
      <h1 className="text-white text-xl font-bold">다올커머스 업무 시스템</h1>
      <p className="text-slate-400 text-sm mt-2">{name}님, 어떤 업무로 들어가시겠어요?</p>

      <div className="flex gap-4 mt-8 flex-wrap justify-center">
        <Link href="/orders"
          className="block bg-white rounded-2xl p-7 w-64 hover:-translate-y-0.5 hover:shadow-xl transition-all">
          <div className="text-base font-bold text-slate-900">주문 관리</div>
          <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            주문 입력 · 주문 현황<br />발주서 작성 · 발송 · 배송 관리
          </div>
          <div className="mt-4 inline-block px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-semibold">
            들어가기
          </div>
        </Link>

        {isAdmin ? (
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
        ) : (
          <div className="bg-white/5 border border-white/15 rounded-2xl p-7 w-64">
            <div className="text-base font-bold text-slate-300">회계 · 경영 관리</div>
            <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              매출처 허브 · 회계 장부<br />경영대시보드 · 정리 도구
            </div>
            <div className="mt-4 text-[11px] text-slate-500">권한 없음 — 관리자에게 요청</div>
          </div>
        )}
      </div>

      <p className="text-slate-600 text-[11px] mt-10">역할: {isAdmin ? '관리자 (전체 접근)' : '영업 (주문 관리)'}</p>
    </div>
  )
}
