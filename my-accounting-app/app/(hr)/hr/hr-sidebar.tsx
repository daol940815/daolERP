'use client'

// 직원 관리 모드 사이드바 — 주문·회계 모드와 동일한 구조·팔레트
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { UserRole } from '@/lib/user-role'

export default function HrSidebar({ name, roleLabel, role }: {
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

  const menus = [
    { href: '/hr/attendance', label: '내 근태' },
    ...(role !== 'sales' ? [{ href: '/hr/approvals', label: '휴가 승인' }] : []),
    ...(role === 'admin' ? [{ href: '/hr/admin', label: '근태 현황' }] : []),
  ]

  return (
    <aside className="w-64 bg-slate-900 flex flex-col shrink-0">
      {/* 로고 영역 — 다른 모드와 동일 배치 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">다올 직원관리</h1>
        <p className="text-slate-400 text-xs mt-0.5">{name} · {roleLabel}</p>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            근태
          </p>
          {menus.map(m => (
            <Link key={m.href} href={m.href} className={linkCls(pathname === m.href)}>
              <span>{m.label}</span>
            </Link>
          ))}
        </div>

        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            모드
          </p>
          <Link href="/portal" className={linkCls(false)}>
            <span>모드 선택</span>
          </Link>
          <Link href="/orders" className={linkCls(false)}>
            <span>주문 관리 모드로 이동</span>
          </Link>
          {role === 'admin' && (
            <Link href="/" className={linkCls(false)}>
              <span>회계·경영 모드로 이동</span>
            </Link>
          )}
        </div>
      </nav>

      {/* 하단 로그아웃 — 다른 모드와 동일 */}
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
