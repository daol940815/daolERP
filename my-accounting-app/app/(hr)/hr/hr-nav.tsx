'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { UserRole } from '@/lib/user-role'

// 직원 관리 모드 상단 메뉴 — 역할에 따라 승인·현황 메뉴 노출
export default function HrNav({ role }: { role: UserRole }) {
  const pathname = usePathname()
  const menus = [
    { href: '/hr/attendance', label: '내 근태' },
    ...(role !== 'sales' ? [{ href: '/hr/approvals', label: '휴가 승인' }] : []),
    ...(role === 'admin' ? [{ href: '/hr/admin', label: '근태 현황' }] : []),
  ]
  return (
    <nav className="flex items-center gap-1">
      {menus.map(m => {
        const active = pathname === m.href
        return (
          <Link key={m.href} href={m.href}
            className={`px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-white/15 text-white font-semibold' : 'text-slate-300 hover:text-white'}`}>
            {m.label}
          </Link>
        )
      })}
    </nav>
  )
}
