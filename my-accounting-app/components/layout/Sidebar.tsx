'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { BankAccount } from '@/types/bank-account'

// ── 계좌 직접 등록 모달 ─────────────────────────────────────────
function AddBankModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm]     = useState({ bank_name: '', account_number: '', alias: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [linked, setLinked] = useState<number | null>(null)

  const handleSave = async () => {
    if (!form.bank_name.trim()) { setError('은행명을 입력하세요.'); return }
    setSaving(true)
    const res = await fetch('/api/bank-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bank_name:      form.bank_name.trim(),
        account_number: form.account_number.trim() || undefined,
        alias:          form.alias.trim()          || undefined,
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error ?? '저장 실패'); return }
    // 자동 연결된 거래 건수 표시 후 닫기
    setLinked(json.linkedTransactions ?? 0)
    onSaved()
    setTimeout(() => onClose(), 1200)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl p-6 w-80 mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900 mb-1">계좌 직접 등록</h3>
        <p className="text-xs text-gray-400 mb-4">파일 업로드 없이 계좌를 먼저 등록합니다.</p>
        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              은행명 <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={form.bank_name}
              onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              placeholder="예: 우리은행"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              계좌번호 <span className="text-gray-400">(선택)</span>
            </label>
            <input
              value={form.account_number}
              onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
              placeholder="예: 1005-804-575410"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              별칭 <span className="text-gray-400">(선택)</span>
            </label>
            <input
              value={form.alias}
              onChange={e => setForm(f => ({ ...f, alias: e.target.value }))}
              placeholder="예: 법인 운영계좌"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving || linked !== null}
            className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : linked !== null ? '✓ 등록 완료' : '등록'}
          </button>
        </div>
        {linked !== null && linked > 0 && (
          <p className="text-xs text-green-600 text-center mt-2">
            기존 거래 {linked.toLocaleString()}건이 자동 연결되었습니다.
          </p>
        )}
      </div>
    </div>
  )
}

export default function Sidebar({ initialBanks = [] }: { initialBanks?: BankAccount[] }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [banks, setBanks] = useState<BankAccount[]>(initialBanks)
  const [banksOpen, setBanksOpen] = useState(true)
  const [taxInvoicesOpen, setTaxInvoicesOpen] = useState(false)
  const [editingBankId, setEditingBankId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // URL 쿼리 파라미터에서 직접 읽어 pathname 변경 없이도 계좌 선택 상태 반영
  const activeBankId = searchParams.get('bankAccountId')

  const fetchBanks = () => {
    fetch('/api/bank-accounts', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setBanks(d.data) })
      .catch(() => null)
  }

  useEffect(() => { fetchBanks() }, [pathname])

  // 편집 모드 시작
  const startEdit = (bankId: string, currentNumber: string | null) => {
    setEditingBankId(bankId)
    setEditingValue(currentNumber ?? '')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // 계좌번호 저장
  const handleSaveAccountNumber = async (bankId: string) => {
    const newNumber = editingValue.trim() || null
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
      const saved = (json.data?.account_number as string | null) ?? null
      setBanks(prev => prev.map(b =>
        b.id === bankId ? { ...b, account_number: saved } : b
      ))
      setEditingBankId(null)
      // DB 실제 저장값으로 재동기화
      fetchBanks()
    } catch {
      alert('네트워크 오류가 발생했습니다.')
    }
  }

  const handleDeleteBank = async (bankId: string, bankName: string) => {
    if (!window.confirm(`'${bankName}' 계좌를 삭제하시겠습니까?\n거래 내역은 유지되지만 계좌 연결이 해제됩니다.`)) return
    const res = await fetch(`/api/bank-accounts/${bankId}`, { method: 'DELETE' })
    if (res.ok) {
      fetchBanks()
      if (activeBankId === bankId) router.push('/transactions')
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
    <>
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

          {/* ── 카드결제내역(매출) (거래 내역 하위) ── */}
          <div className="ml-3 pl-3 border-l border-slate-700 mt-0.5 mb-0.5">
            <Link href="/card-sales" className={linkCls(pathname.startsWith('/card-sales'))}>
              <span className="text-base leading-none">💳</span>
              <span>카드결제내역(매출)</span>
            </Link>
          </div>

          {/* ── 현금영수증 (거래 내역 하위) ── */}
          <div className="ml-3 pl-3 border-l border-slate-700 mt-0.5 mb-0.5">
            <Link href="/cash-receipts" className={linkCls(pathname.startsWith('/cash-receipts'))}>
              <span className="text-base leading-none">🧾</span>
              <span>현금영수증</span>
            </Link>
          </div>

          {/* ── ERP 주문내역 (거래 내역 하위) ── */}
          <div className="ml-3 pl-3 border-l border-slate-700 mt-0.5 mb-0.5">
            <Link href="/erp-orders" className={linkCls(pathname.startsWith('/erp-orders'))}>
              <span className="text-base leading-none">📦</span>
              <span>ERP 주문내역</span>
            </Link>
          </div>

          {/* ── 세금계산서 섹션 (거래 내역 하위) ── */}
          <div className="ml-3 pl-3 border-l border-slate-700 mt-0.5 mb-0.5">
            <button
              onClick={() => setTaxInvoicesOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors mb-0.5"
            >
              <span className="flex items-center gap-2.5">
                <span className="text-base leading-none">🧾</span>
                <span>세금계산서</span>
              </span>
              <span className="text-xs opacity-60">{taxInvoicesOpen ? '▾' : '▸'}</span>
            </button>

            {taxInvoicesOpen && (
              <div className="ml-3 pl-3 border-l border-slate-700 mb-0.5 space-y-2">
                {([
                  { dir: 'sales',    label: '매출 세금계산서' },
                  { dir: 'purchase', label: '매입 세금계산서' },
                ] as const).map(group => (
                  <div key={group.dir}>
                    <p className="px-3 py-1 text-xs text-slate-500">{group.label}</p>
                    {([
                      { type: 'taxable', label: '전자세금계산서(과세)' },
                      { type: 'exempt',  label: '전자계산서(면세)' },
                    ] as const).map(sub => {
                      const href = `/tax-invoices/${group.dir}/${sub.type}`
                      return (
                        <Link key={sub.type} href={href} className={linkCls(pathname === href)}>
                          <span className="text-xs leading-none text-slate-500 shrink-0">·</span>
                          <span className="truncate">{sub.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 은행 계좌 섹션 (거래 내역 하위) ── */}
          <div className="ml-3 pl-3 border-l border-slate-700 mt-0.5 mb-0.5">
            <button
              onClick={() => setBanksOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors mb-0.5"
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
                    <div key={bank.id} className="mb-0.5">
                      {editingBankId === bank.id ? (
                        /* 계좌번호 인라인 편집 */
                        <div className="px-2 py-2 rounded-lg bg-slate-800">
                          <p className="text-xs text-slate-400 mb-1.5 truncate">{bank.bank_name}</p>
                          <div className="flex gap-1">
                            <input
                              ref={inputRef}
                              value={editingValue}
                              onChange={e => setEditingValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveAccountNumber(bank.id)
                                if (e.key === 'Escape') setEditingBankId(null)
                              }}
                              placeholder="계좌번호"
                              className="flex-1 min-w-0 text-xs bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 focus:outline-none focus:border-blue-400 placeholder-slate-500"
                            />
                            <button
                              onClick={() => handleSaveAccountNumber(bank.id)}
                              className="shrink-0 text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500"
                            >
                              저장
                            </button>
                            <button
                              onClick={() => setEditingBankId(null)}
                              className="shrink-0 text-xs px-1.5 py-1 text-slate-400 hover:text-white"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* 일반 표시 */
                        <div className="group relative">
                          <Link
                            href={`/transactions?bankAccountId=${bank.id}`}
                            className={linkCls(activeBankId === bank.id)}
                          >
                            <span className="text-xs leading-none text-slate-500 shrink-0">·</span>
                            <div className="flex flex-col min-w-0 flex-1 pr-5">
                              <span className="truncate">{bank.bank_name}</span>
                              {bank.account_number && (
                                <span className="text-xs text-slate-500 font-normal truncate">
                                  {bank.account_number}
                                </span>
                              )}
                            </div>
                          </Link>
                          {/* 호버 시 액션 버튼 */}
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                            <button
                              onClick={() => startEdit(bank.id, bank.account_number)}
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
                      )}
                    </div>
                  ))
                )}

                {/* 계좌 추가 */}
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mt-0.5 w-full text-left"
                >
                  <span>＋</span>
                  <span>계좌 직접 등록</span>
                </button>
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

        {/* ── 자료출력 ── */}
        <div className="mb-5">
          <p className="px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
            자료출력
          </p>
          <Link href="/reports/vendor-status/sales" className={linkCls(pathname === '/reports/vendor-status/sales')}>
            <span className="text-base leading-none">📥</span>
            <span>매출처 수금현황</span>
          </Link>
          <Link href="/reports/vendor-status/purchase" className={linkCls(pathname === '/reports/vendor-status/purchase')}>
            <span className="text-base leading-none">📤</span>
            <span>매입처 결제현황</span>
          </Link>
          <Link href="/reports/erp-receivables" className={linkCls(pathname.startsWith('/reports/erp-receivables'))}>
            <span className="text-base leading-none">📦</span>
            <span>ERP 매출처 미수금</span>
          </Link>
          <Link href="/reports/erp-payables" className={linkCls(pathname.startsWith('/reports/erp-payables'))}>
            <span className="text-base leading-none">🏭</span>
            <span>ERP 매입처 결제현황</span>
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
          <Link href="/vendors/customers" className={linkCls(pathname === '/vendors/customers')}>
            <span className="text-base leading-none">🏢</span>
            <span>매출처 관리</span>
          </Link>
          <Link href="/vendors/suppliers" className={linkCls(pathname === '/vendors/suppliers')}>
            <span className="text-base leading-none">🏭</span>
            <span>매입처 관리</span>
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

    {/* 계좌 직접 등록 모달 */}
    {showAddModal && (
      <AddBankModal
        onClose={() => setShowAddModal(false)}
        onSaved={() => fetchBanks()}
      />
    )}
  </>
  )
}
