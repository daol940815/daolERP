'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MENUS = [
  { href: '/orders', label: '주문 현황', ready: true },
  { href: '/orders/new', label: '신규 주문', ready: false },
  { href: '/orders/purchase', label: '발주서', ready: false },
  { href: '/orders/delivery', label: '배송 관리', ready: false },
]

export default function OrdersNav() {
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-1">
      {MENUS.map(m => {
        const active = pathname === m.href
        return m.ready ? (
          <Link key={m.href} href={m.href}
            className={`px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-white/15 text-white font-semibold' : 'text-slate-300 hover:text-white'}`}>
            {m.label}
          </Link>
        ) : (
          <span key={m.href} title="다음 단계에서 열립니다"
            className="px-3 py-1.5 text-sm text-slate-600 cursor-not-allowed">
            {m.label}
          </span>
        )
      })}
    </nav>
  )
}
