'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// 사이드바 메뉴 구조 정의
const menuItems = [
  {
    section: '거래 관리',
    items: [
      { label: '대시보드',     href: '/',                icon: '▦' },
      { label: '거래 내역',    href: '/transactions',    icon: '≡' },
      { label: '파일 업로드',  href: '/upload',          icon: '↑' },
    ],
  },
  {
    section: '분개 / 장부',
    items: [
      { label: '분개 현황',    href: '/journal',         icon: '📋' },
      { label: '계정별 원장',  href: '/ledger',          icon: '📒' },
    ],
  },
  {
    section: '기준 정보',
    items: [
      { label: '계정과목',     href: '/accounts',        icon: '🏷' },
      { label: '거래처 관리',  href: '/vendors',         icon: '🏢' },
    ],
  },
  {
    section: '설정',
    items: [
      { label: '설정',         href: '/settings',        icon: '⚙' },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  // 로그아웃 처리
  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-60 min-h-screen bg-slate-900 flex flex-col">
      {/* 서비스 로고 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">daolERP</h1>
        <p className="text-slate-400 text-xs mt-0.5">회계 관리 시스템</p>
      </div>

      {/* 메뉴 목록 */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {menuItems.map((group) => (
          <div key={group.section} className="mb-5">
            {/* 섹션 헤더 */}
            <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
              {group.section}
            </p>

            {group.items.map((item) => {
              // 현재 페이지인지 확인 (/ 는 정확히 일치, 나머지는 startsWith)
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5
                    ${isActive
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }
                  `}
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* 하단 로그아웃 버튼 */}
      <div className="px-3 py-4 border-t border-slate-700">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
                     text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span className="text-base leading-none">→</span>
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  )
}
