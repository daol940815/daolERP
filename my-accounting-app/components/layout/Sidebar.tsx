'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { BankAccount } from '@/types/bank-account'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [banksOpen, setBanksOpen] = useState(true)
  const [activeBankId, setActiveBankId] = useState<string | null>(null)

  // 페이지 이동마다 은행 계좌 목록 갱신
  useEffect(() => {
    fetch('/api/bank-accounts')
      .then(r => r.json())
      .then(d => { if (d.data) setBanks(d.data) })
      .catch(() => null)
  }, [pathname])

  // URL 변경 시 active 은행 ID 갱신
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setActiveBankId(params.get('bankAccountId'))
  }, [pathname])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const linkCls = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
      isActive
        ? 'bg-slate-700 text-white font-medium'
        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`

  return (
    <aside className="w-60 min-h-screen bg-slate-900 flex flex-col">
      {/* 서비스 로고 */}
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">daolERP</h1>
        <p className="text-slate-400 text-xs mt-0.5">회계 관리 시스템</p>
      </div>

      {/* 메뉴 목록 */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {/* ── 거래 관리 ── */}
        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            거래 관리
          </p>

          <Link href="/" className={linkCls(pathname === '/')}>
            <span className="text-base leading-none">▦</span>
            <span>대시보드</span>
          </Link>

          <Link href="/transactions" className={linkCls(pathname === '/transactions' && !activeBankId)}>
            <span className="text-base leading-none">≡</span>
            <span>거래 내역</span>
          </Link>

          <Link href="/upload" className={linkCls(pathname.startsWith('/upload'))}>
            <span className="text-base leading-none">↑</span>
            <span>파일 업로드</span>
          </Link>

          {/* 은행 계좌 섹션 */}
          {banks.length > 0 && (
            <div className="mt-1">
              <button
                onClick={() => setBanksOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors mb-0.5"
              >
                <span className="flex items-center gap-2.5">
                  <span className="text-base leading-none">🏦</span>
                  <span>은행 계좌</span>
                </span>
                <span className="text-xs opacity-60">{banksOpen ? '▾' : '▸'}</span>
              </button>

              {banksOpen && (
                <div className="ml-3 pl-3 border-l border-slate-700">
                  {banks.map(bank => (
                    <Link
                      key={bank.id}
                      href={`/transactions?bankAccountId=${bank.id}`}
                      className={linkCls(activeBankId === bank.id)}
                    >
                      <span className="text-xs leading-none text-slate-500">·</span>
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{bank.bank_name}</span>
                        {bank.current_balance !== null && (
                          <span className="text-xs text-slate-500 font-normal">
                            {bank.current_balance.toLocaleString('ko-KR')}원
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 분개 / 장부 ── */}
        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            분개 / 장부
          </p>
          <Link href="/journal" className={linkCls(pathname.startsWith('/journal'))}>
            <span className="text-base leading-none">📋</span>
            <span>분개 현황</span>
          </Link>
          <Link href="/ledger" className={linkCls(pathname.startsWith('/ledger'))}>
            <span className="text-base leading-none">📒</span>
            <span>계정별 원장</span>
          </Link>
        </div>

        {/* ── 기준 정보 ── */}
        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            기준 정보
          </p>
          <Link href="/accounts" className={linkCls(pathname.startsWith('/accounts'))}>
            <span className="text-base leading-none">🏷</span>
            <span>계정과목</span>
          </Link>
          <Link href="/vendors" className={linkCls(pathname.startsWith('/vendors'))}>
            <span className="text-base leading-none">🏢</span>
            <span>거래처 관리</span>
          </Link>
        </div>

        {/* ── 설정 ── */}
        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            설정
          </p>
          <Link href="/settings" className={linkCls(pathname.startsWith('/settings'))}>
            <span className="text-base leading-none">⚙</span>
            <span>설정</span>
          </Link>
        </div>
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
