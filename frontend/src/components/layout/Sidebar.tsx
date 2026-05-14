'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  List,
  Upload,
  History,
  Building2,
  CreditCard,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useInstitutions, useAccounts } from '@/hooks/useTransactions'
import { useStore } from '@/store/useStore'
import type { Institution } from '@/types'

const navItems = [
  { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/', label: '거래내역', icon: List },
  { href: '/upload', label: '파일 업로드', icon: Upload },
  { href: '/history', label: '업로드 이력', icon: History },
]

function InstitutionTree() {
  const { data: institutions = [] } = useInstitutions()
  const { setSelectedInstitution, setSelectedAccount, selectedInstitution, selectedAccount } = useStore()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const banks = institutions.filter(i => i.type === 'bank')
  const cards = institutions.filter(i => i.type === 'card')

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderInstitution = (inst: Institution) => {
    const isExpanded = expandedIds.has(inst.id)
    const isSelected = selectedInstitution?.id === inst.id && !selectedAccount

    return (
      <div key={inst.id}>
        <button
          onClick={() => {
            toggleExpand(inst.id)
            setSelectedInstitution(inst)
          }}
          className={clsx(
            'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left',
            isSelected
              ? 'bg-blue-600/20 text-blue-400'
              : 'text-slate-300 hover:bg-slate-700/50'
          )}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          )}
          <span className="truncate">{inst.name}</span>
        </button>
        {isExpanded && (
          <AccountSubTree institutionId={inst.id} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5" /> 은행
      </div>
      {banks.map(renderInstitution)}

      <div className="px-3 py-1 mt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        <CreditCard className="w-3.5 h-3.5" /> 카드
      </div>
      {cards.map(renderInstitution)}
    </div>
  )
}

function AccountSubTree({ institutionId }: { institutionId: number }) {
  const { data: accounts = [] } = useAccounts(institutionId)
  const { setSelectedAccount, selectedAccount } = useStore()

  if (accounts.length === 0) {
    return (
      <div className="ml-6 px-3 py-1 text-xs text-slate-600 italic">계좌 없음</div>
    )
  }

  return (
    <div className="ml-5 space-y-0.5 mt-0.5">
      {accounts.map(acc => (
        <button
          key={acc.id}
          onClick={() => setSelectedAccount(acc)}
          className={clsx(
            'w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-colors text-left',
            selectedAccount?.id === acc.id
              ? 'bg-blue-600/20 text-blue-400'
              : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
          )}
        >
          <span className="w-1 h-1 rounded-full bg-slate-600 flex-shrink-0" />
          <span className="truncate">{acc.account_name || acc.account_number || `계좌 #${acc.id}`}</span>
        </button>
      ))}
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen } = useStore()

  if (!sidebarOpen) return null

  return (
    <aside className="w-56 flex-shrink-0 bg-[#161d2e] border-r border-[#2e3a4e] flex flex-col overflow-hidden">
      {/* 로고 */}
      <div className="px-4 py-4 border-b border-[#2e3a4e]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">FB</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">FinBook</div>
            <div className="text-xs text-slate-500">경리 관리 시스템</div>
          </div>
        </div>
      </div>

      {/* 메뉴 */}
      <nav className="p-2 space-y-0.5 border-b border-[#2e3a4e]">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-blue-600/20 text-blue-400 font-medium'
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* 기관 트리 */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 px-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          금융기관
        </div>
        <InstitutionTree />
      </div>
    </aside>
  )
}
