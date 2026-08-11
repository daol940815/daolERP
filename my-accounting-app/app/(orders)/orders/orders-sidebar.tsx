'use client'

// 직원 워크스페이스 사이드바 (B안: 단일 워크스페이스) — 회계·경영 모드(Sidebar.tsx)와
// 동일한 구조·팔레트. 내 대시보드 / 주문 / 근태·휴가 / 내 영업일지를 한 곳에서 잇는다.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { UserRole } from '@/lib/user-role'
import CheckWidget from './check-widget'

const MENUS = [
  { href: '/orders', label: '주문 현황', ready: true },
  { href: '/orders/consultations', label: '상담일지', ready: true },
  { href: '/orders/new', label: '신규 주문', ready: true },
  { href: '/orders/products', label: '품목 마스터', ready: true },
  { href: '/orders/purchase', label: '발주서', ready: false },
  { href: '/orders/delivery', label: '배송 관리', ready: false },
]

export default function OrdersSidebar({ name, roleLabel, role }: {
  name: string; roleLabel: string; role: UserRole
}) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const linkCls = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
      isActive ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`

  return (
    <aside className="w-64 bg-slate-900 flex flex-col shrink-0">
      {/* 로고 영역 — 회계 모드와 동일 배치 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">다올 워크스페이스</h1>
        <p className="text-slate-400 text-xs mt-0.5">{name} · {roleLabel}</p>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            내 업무
          </p>
          <Link href="/me" className={linkCls(pathname === '/me')}>
            <span>내 대시보드</span>
          </Link>
          <Link href="/me/journal" className={linkCls(pathname === '/me/journal')}>
            <span>내 영업일지</span>
          </Link>
        </div>

        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            주문 관리
          </p>
          {MENUS.map(m =>
            m.ready ? (
              <Link key={m.href} href={m.href} className={linkCls(pathname === m.href)}>
                <span>{m.label}</span>
              </Link>
            ) : (
              <span key={m.href} title="다음 단계에서 열립니다"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 cursor-not-allowed mb-0.5">
                <span>{m.label}</span>
                <span className="ml-auto text-[10px] text-slate-600 border border-slate-700 rounded px-1">준비 중</span>
              </span>
            ),
          )}
          {role !== 'sales' && (
            <Link href="/orders/approvals" className={linkCls(pathname === '/orders/approvals')}>
              <span>주문 수정 승인</span>
            </Link>
          )}
        </div>

        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            근태 · 휴가
          </p>
          <CheckWidget />
          <Link href="/hr/attendance" className={linkCls(false)}>
            <span>근태 · 휴가</span>
          </Link>
          {role !== 'sales' && (
            <Link href="/hr/approvals" className={linkCls(false)}>
              <span>휴가 승인</span>
            </Link>
          )}
        </div>

        {/* 모드 선택은 admin 전용 — 일반 직원·중간 관리자는 워크스페이스가 유일한 홈 */}
        {role === 'admin' && (
          <div className="mb-5">
            <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
              모드
            </p>
            <Link href="/portal" className={linkCls(false)}>
              <span>모드 선택</span>
            </Link>
            <Link href="/" className={linkCls(false)}>
              <span>회계·경영 모드로 이동</span>
            </Link>
          </div>
        )}
      </nav>

      {/* 하단 로그아웃 — 회계 모드와 동일 */}
      <div className="px-3 py-4 border-t border-slate-700">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
                     text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  )
}
