import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'
import OrdersSidebar from './orders-sidebar'

export const dynamic = 'force-dynamic'

// 주문 관리 모드 공통 레이아웃 — 회계·경영 모드와 동일한 좌측 사이드바 구조
export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser()
  if (!me) redirect('/login')

  const roleLabel = me.role === 'admin' ? '전체 관리자' : me.role === 'manager' ? '중간 관리자' : '직원'

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <OrdersSidebar
        name={me.employeeName ?? me.email ?? '사용자'}
        roleLabel={roleLabel}
        isAdmin={me.role === 'admin'}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
