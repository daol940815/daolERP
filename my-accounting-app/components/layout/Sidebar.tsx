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

  const fetchBanks = () => {
    fetch('/api/bank-accounts')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setBanks(d.data) })
      .catch(() => null)
  }

  // 페이지 이동마다 은행 계좌 목록 갱신
  useEffect(() => { fetchBanks() }, [pathname])

  // URL 변경 시 active 은행 ID 갱신
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setActiveBankId(params.get('bankAccountId'))
  }, [pathname])

  const handleDeleteBank = async (bankId: string, bankName: string) => {
    if (!window.confirm(`'${bankName}' 계좌를 삭제하시겠습니까?\n거래 내역은 유지되지만 계좌 연결이 해제됩니다.`)) return
    const res = await fetch(`/api/bank-accounts/${bankId}`, { method: 'DELETE' })
    if (res.ok) {
      fetchBanks()
      if (activeBankId === bankId) router.push('/transactions')
    }
  }

  const handleEditAccountNumber = async (bankId: string, currentNumber: string | null) => {
    const input = window.prompt('계좌번호를 입력하세요 (예: 1005-804-575410)', currentNumber ?? '')
    if (input === null) return  // 취소

    const newNumber = input.trim() || null

    try {
      const res = await fetch(`/api/bank-accounts/${bankId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number: newNumber }),
      })

      const json = await res.json()

      if (!res.ok) {
        alert(`저장 실패: ${json.error ?? '알 수 없는 오류'}`)
        return
      }

      // DB에서 반환된 실제 값으로 상태 갱신
      const saved = json.data?.account_number ?? null
      setBanks(prev => prev.map(b =>
        b.id === bankId ? { ...b, account_number: saved } : b
      ))
    } catch {
      alert('네트워크 오류가 발생했습니다.')
      fetchBanks()
    }
  }

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

          {/* ── 은행 계좌 섹션 (항상 표시) ── */}
          <div className="mt-0.5">
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
              <div className="ml-3 pl-3 border-l border-slate-700 mb-0.5">
                {banks.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-slate-600">등록된 계좌가 없습니다</p>
                ) : (
                  banks.map(bank => (
                    <div key={bank.id} className="group relative mb-0.5">
                      <Link
                        href={`/transactions?bankAccountId=${bank.id}`}
                        className={linkCls(activeBankId === bank.id)}
                      >
                        <span className="text-xs leading-none text-slate-500 shrink-0">·</span>
                        <div className="flex flex-col min-w-0 flex-1 pr-5">
                          <span className="truncate">
                            {bank.bank_name}
                          </span>
                          {bank.account_number && (
                            <span className="text-xs text-slate-500 font-normal truncate">
                              {bank.account_number}
                            </span>
                          )}
                        </div>
                      </Link>
                      {/* 호버 시 액션 버튼들 */}
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                        <button
                          onClick={() => handleEditAccountNumber(bank.id, bank.account_number)}
                          className="flex items-center justify-center w-5 h-5 rounded text-slate-500
                                     hover:text-slate-300 hover:bg-slate-700 transition-colors text-xs"
                          title="계좌번호 수정"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeleteBank(bank.id, bank.bank_name)}
                          className="flex items-center justify-center w-5 h-5 rounded text-slate-500
                                     hover:text-red-400 hover:bg-slate-700 transition-colors text-xs"
                          title="계좌 삭제"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {/* 계좌 추가 버튼 */}
                <Link
                  href="/upload"
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mt-0.5"
                >
                  <span>＋</span>
                  <span>계좌 추가</span>
                </Link>
              </div>
            )}
          </div>

          <Link href="/upload" className={linkCls(pathname.startsWith('/upload'))}>
            <span className="text-base leading-none">↑</span>
            <span>파일 업로드</span>
          </Link>
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
