import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'
import OrdersNav from './orders-nav'

export const dynamic = 'force-dynamic'

// 주문 관리 모드 공통 레이아웃 — 영업·관리자 모두 접근 가능
export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser()
  if (!me) redirect('/login')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-6">
          <Link href="/portal" className="font-bold">다올 주문관리</Link>
          <OrdersNav />
          <span className="ml-auto text-xs text-slate-400">
            {me.employeeName ?? me.email}{me.role === 'admin' ? ' · 관리자' : ''}
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
