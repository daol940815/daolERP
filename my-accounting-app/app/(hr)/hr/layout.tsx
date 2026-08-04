import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'
import HrNav from './hr-nav'

export const dynamic = 'force-dynamic'

// 직원 관리 모드 공통 레이아웃 — 전 직원 접근 가능 (주문 관리 모드와 동일한 구조)
export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser()
  if (!me) redirect('/login')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-6">
          <Link href="/portal" className="font-bold">다올 직원관리</Link>
          <HrNav role={me.role} />
          <span className="ml-auto text-xs text-slate-400">
            {me.employeeName ?? me.email}
            {me.role === 'admin' ? ' · 전체 관리자' : me.role === 'manager' ? ' · 중간 관리자' : ''}
          </span>
          {me.role === 'admin' && (
            <Link href="/" className="text-xs text-slate-300 hover:text-white border border-slate-700 rounded px-2 py-1">
              회계·경영 모드
            </Link>
          )}
          <Link href="/portal" className="text-xs text-slate-300 hover:text-white">모드 선택</Link>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-5 py-6">{children}</main>
    </div>
  )
}
