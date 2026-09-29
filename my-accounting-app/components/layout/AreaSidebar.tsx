'use client'

// 4영역 공용 사이드바 — 메뉴 목록(lib/menu-registry.ts)에서 그린다.
// 영역·그룹·항목은 서버(AreaShell)가 권한으로 걸러 넘기고, 여기서는 표시만 한다.
// 회계·재무 영역의 통장 내역·카드 내역은 계좌별·카드별 바로가기(편집 포함)를 하위에 둔다.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { BankAccount } from '@/types/bank-account'
import type { AreaKey } from '@/lib/permissions'
import type { MenuGroup, MenuItem } from '@/lib/menu-registry'
import AddBankModal from './AddBankModal'
import CheckWidget from '@/app/(orders)/orders/check-widget'

interface CardAccountItem { id: string; card_company: string; card_number: string; alias: string | null }

export interface AreaSidebarProps {
  area: AreaKey
  areaLabel: string
  groups: MenuGroup[]
  userName: string
  userSub: string
  showAreaSelect: boolean
  initialBanks?: BankAccount[]
}

export default function AreaSidebar({ area, areaLabel, groups, userName, userSub, showAreaSelect, initialBanks = [] }: AreaSidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  // 사이드바가 그려질 때마다 현재 영역을 쿠키에 남긴다 — 두 영역이 공유하는 화면(매출처 관리·
  // 휴가 승인 등)으로 이동해도 지금 보고 있던 영역에 머물게 하기 위해서다.
  useEffect(() => {
    try { document.cookie = `daol-area=${area}; path=/; max-age=31536000; samesite=lax` } catch { /* 무시 */ }
  }, [area])

  // ── 그룹 접기 (localStorage 유지 + 현재 화면 그룹 자동 열기) ──
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map(g => [g.key, !g.foldDefault])))
  useEffect(() => {
    let saved: Record<string, boolean> = {}
    try { saved = JSON.parse(localStorage.getItem('sidebar-groups-v2') ?? '{}') } catch { /* 무시 */ }
    const active = groups.find(g => g.items.some(it => isActive(it)))?.key
    setOpen(o => ({ ...o, ...saved, ...(active ? { [active]: true } : {}) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  const toggle = (k: string) => setOpen(o => {
    const next = { ...o, [k]: !o[k] }
    try { localStorage.setItem('sidebar-groups-v2', JSON.stringify(next)) } catch { /* 무시 */ }
    return next
  })

  // ── 계좌·카드 동적 목록 (회계·재무 영역만) ──
  const [banks, setBanks] = useState<BankAccount[]>(initialBanks)
  const [cards, setCards] = useState<CardAccountItem[]>([])
  const [banksOpen, setBanksOpen] = useState(true)
  const [cardsOpen, setCardsOpen] = useState(true)
  const [childrenOpen, setChildrenOpen] = useState<Record<string, boolean>>({})
  const [editingBankId, setEditingBankId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editingCardAlias, setEditingCardAlias] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cardInputRef = useRef<HTMLInputElement>(null)
  const activeBankId = searchParams.get('bankAccountId')
  const activeCardId = searchParams.get('cardAccountId')
  const hasDynamic = groups.some(g => g.items.some(it => it.dynamic))

  const fetchBanks = () => {
    fetch('/api/bank-accounts', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setBanks(d.data) }).catch(() => null)
  }
  const fetchCards = () => {
    fetch('/api/card-accounts', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setCards(d.data) }).catch(() => null)
  }
  useEffect(() => { if (hasDynamic) { fetchBanks(); fetchCards() } }, [pathname, hasDynamic])

  const startEdit = (bankId: string, cur: string | null) => {
    setEditingBankId(bankId); setEditingValue(cur ?? ''); setTimeout(() => inputRef.current?.focus(), 50)
  }
  const startCardEdit = (cardId: string, cur: string | null) => {
    setEditingCardId(cardId); setEditingCardAlias(cur ?? ''); setTimeout(() => cardInputRef.current?.focus(), 50)
  }
  const handleSaveCardAlias = async (cardId: string) => {
    try {
      const res = await fetch(`/api/card-accounts/${cardId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: editingCardAlias.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) { alert(`저장 실패: ${json.error ?? '알 수 없는 오류'}`); return }
      setEditingCardId(null); fetchCards()
    } catch { alert('네트워크 오류가 발생했습니다.') }
  }
  const handleSaveAccountNumber = async (bankId: string) => {
    try {
      const res = await fetch(`/api/bank-accounts/${bankId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number: editingValue.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) { alert(`저장 실패: ${json.error ?? '알 수 없는 오류'}`); return }
      setEditingBankId(null); fetchBanks()
    } catch { alert('네트워크 오류가 발생했습니다.') }
  }
  const handleDeleteBank = async (bankId: string, bankName: string) => {
    if (!window.confirm(`'${bankName}' 계좌를 삭제하시겠습니까?\n거래 내역은 유지되지만 계좌 연결이 해제됩니다.`)) return
    const res = await fetch(`/api/bank-accounts/${bankId}`, { method: 'DELETE' })
    if (res.ok) { fetchBanks(); if (activeBankId === bankId) router.push('/transactions') }
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // ── 활성 판정: 정확 일치 / 접두 / 쿼리 항목(?mine, ?type=) ──
  function isActive(it: MenuItem): boolean {
    const [base, query] = (it.prefix ?? it.href).split('?')
    if (query) {
      const want = new URLSearchParams(query)
      const okQuery = Array.from(want.entries()).every(([k, v]) => searchParams.get(k) === v)
      return pathname === base && okQuery
    }
    if (it.exact) {
      if (pathname !== base) return false
      // 같은 경로에 쿼리 항목이 따로 있으면(내 고객 ?mine=1) 그쪽이 활성
      return !searchParams.get('mine') && !searchParams.get('type')
    }
    if (it.dynamic === 'banks' && activeBankId) return false
    if (it.dynamic === 'cards' && activeCardId) return false
    return pathname === base || pathname.startsWith(base + '/')
  }

  const linkCls = (on: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
      on ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`
  const subCls = 'ml-3 pl-3 border-l border-slate-700 mb-0.5'
  const dotCls = 'text-xs leading-none text-slate-500 shrink-0'

  const renderBanks = () => (
    <div className={subCls}>
      {banks.length === 0 ? <p className="px-3 py-1.5 text-xs text-slate-600">등록된 계좌가 없습니다</p> : banks.map(bank => (
        <div key={bank.id} className="mb-0.5">
          {editingBankId === bank.id ? (
            <div className="px-2 py-2 rounded-lg bg-slate-800">
              <p className="text-xs text-slate-400 mb-1.5 truncate">{bank.bank_name}</p>
              <div className="flex gap-1">
                <input ref={inputRef} value={editingValue} onChange={e => setEditingValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveAccountNumber(bank.id); if (e.key === 'Escape') setEditingBankId(null) }}
                  placeholder="계좌번호"
                  className="flex-1 min-w-0 text-xs bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 focus:outline-none focus:border-blue-400 placeholder-slate-500" />
                <button onClick={() => handleSaveAccountNumber(bank.id)} className="shrink-0 text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500">저장</button>
                <button onClick={() => setEditingBankId(null)} className="shrink-0 text-xs px-1.5 py-1 text-slate-400 hover:text-white">취소</button>
              </div>
            </div>
          ) : (
            <div className="group relative">
              <Link href={`/transactions?bankAccountId=${bank.id}`} className={linkCls(activeBankId === bank.id)}>
                <span className={dotCls}>·</span>
                <div className="flex flex-col min-w-0 flex-1 pr-5">
                  <span className="truncate flex items-center gap-1.5">
                    {bank.bank_name}
                    {bank.account_type === 'overdraft' && (
                      <span className="shrink-0 px-1 py-0.5 text-[10px] leading-none rounded bg-amber-500/20 text-amber-400">마이너스</span>
                    )}
                  </span>
                  {bank.account_number && <span className="text-xs text-slate-500 font-normal truncate">{bank.account_number}</span>}
                </div>
              </Link>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                <button onClick={() => startEdit(bank.id, bank.account_number)} title="계좌번호 수정"
                  className="w-5 h-5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700 text-xs">✎</button>
                <button onClick={() => handleDeleteBank(bank.id, bank.bank_name)} title="계좌 삭제"
                  className="w-5 h-5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-700 text-xs">✕</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 mt-0.5 w-full text-left">
        <span>＋</span><span>계좌 직접 등록</span>
      </button>
    </div>
  )

  const renderCards = () => cards.length > 0 && (
    <div className={subCls}>
      {cards.map(card => (
        <div key={card.id} className="mb-0.5">
          {editingCardId === card.id ? (
            <div className="px-2 py-2 rounded-lg bg-slate-800">
              <p className="text-xs text-slate-400 mb-1.5 truncate">{card.card_company} · 끝 {card.card_number.replace(/\D/g, '').slice(-4)}</p>
              <div className="flex gap-1">
                <input ref={cardInputRef} value={editingCardAlias} onChange={e => setEditingCardAlias(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveCardAlias(card.id); if (e.key === 'Escape') setEditingCardId(null) }}
                  placeholder="별칭 (예: 대표님 카드)"
                  className="flex-1 min-w-0 text-xs bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 focus:outline-none focus:border-blue-400 placeholder-slate-500" />
                <button onClick={() => handleSaveCardAlias(card.id)} className="shrink-0 text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500">저장</button>
                <button onClick={() => setEditingCardId(null)} className="shrink-0 text-xs px-1.5 py-1 text-slate-400 hover:text-white">취소</button>
              </div>
            </div>
          ) : (
            <div className="group relative">
              <Link href={`/card-expenses?cardAccountId=${card.id}`} className={linkCls(pathname.startsWith('/card-expenses') && activeCardId === card.id)}>
                <span className={dotCls}>·</span>
                <div className="flex flex-col min-w-0 flex-1 pr-5">
                  <span className="truncate">{card.alias?.trim() || card.card_company}</span>
                  <span className="text-xs text-slate-500 font-normal truncate">
                    {card.alias?.trim() ? `${card.card_company} · ` : ''}끝 {card.card_number.replace(/\D/g, '').slice(-4)}
                  </span>
                </div>
              </Link>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center">
                <button onClick={() => startCardEdit(card.id, card.alias)} title="별칭 수정"
                  className="w-5 h-5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700 text-xs">✎</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )

  const renderItem = (it: MenuItem) => {
    if (it.wip) {
      return (
        <span key={it.href} title="다음 단계에서 열립니다"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 cursor-not-allowed mb-0.5">
          <span>{it.label}</span>
          <span className="ml-auto text-[10px] text-slate-600 border border-slate-700 rounded px-1">준비 중</span>
        </span>
      )
    }
    if (it.dynamic || it.children) {
      const isOpen = it.dynamic === 'banks' ? banksOpen : it.dynamic === 'cards' ? cardsOpen : (childrenOpen[it.href] ?? isActive(it))
      const setIsOpen = (v: boolean) => it.dynamic === 'banks' ? setBanksOpen(v) : it.dynamic === 'cards' ? setCardsOpen(v) : setChildrenOpen(o => ({ ...o, [it.href]: v }))
      const childActive = it.children?.some(c => pathname === c.href.split('?')[0]) ?? false
      return (
        <div key={it.href}>
          <div className="flex items-center mb-0.5">
            <Link href={it.href} className={`flex-1 min-w-0 ${linkCls(isActive(it) && !childActive)}`}>
              <span className="truncate">{it.label}</span>
            </Link>
            <button onClick={() => setIsOpen(!isOpen)} className="shrink-0 px-2 py-2 text-xs text-slate-500 hover:text-white" title={isOpen ? '접기' : '펼치기'}>
              {isOpen ? '▾' : '▸'}
            </button>
          </div>
          {isOpen && it.dynamic === 'banks' && renderBanks()}
          {isOpen && it.dynamic === 'cards' && renderCards()}
          {isOpen && it.children && (
            <div className={subCls}>
              {it.children.map(c => (
                <Link key={c.href} href={c.href} className={linkCls(pathname === c.href.split('?')[0])}>
                  <span className={dotCls}>·</span><span className="truncate">{c.label}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )
    }
    return (
      <Link key={it.href} href={it.href} className={linkCls(isActive(it))}>
        <span>{it.label}</span>
      </Link>
    )
  }

  return (
    <>
    <aside className="w-64 bg-slate-900 flex flex-col shrink-0">
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg tracking-tight">{areaLabel}</h1>
        <p className="text-slate-400 text-xs mt-0.5">{userName}{userSub ? ` · ${userSub}` : ''}</p>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {groups.map(g => (
          <div key={g.key} className="mb-5">
            <button onClick={() => toggle(g.key)}
              className="w-full flex items-center justify-between px-3 mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider hover:text-slate-300 transition-colors">
              <span>{g.label}</span>
              <span className="opacity-60">{open[g.key] ? '▾' : '▸'}</span>
            </button>
            {open[g.key] && (
              <>
                {area === 'sales' && g.key === 'my' && <CheckWidget />}
                {g.items.map(renderItem)}
              </>
            )}
          </div>
        ))}
      </nav>

      {/* 하단 고정 — 업무 선택(영역 2개 이상)·로그아웃은 메뉴가 길어도 항상 보이도록 */}
      <div className="px-3 py-3 border-t border-slate-700">
        {showAreaSelect && (
          <Link href="/portal" className={linkCls(false)}>
            <span>업무 선택</span>
          </Link>
        )}
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
    {showAddModal && <AddBankModal onClose={() => setShowAddModal(false)} onSaved={fetchBanks} />}
    </>
  )
}
