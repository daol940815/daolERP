'use client'

import { useEffect, useState } from 'react'

// 미등록 은행 점포 (121, 2026-11-23 사용자 결정 — 시안 docs/mockups/은행점포_목록_시안.html)
//  - 주문서 · 상담일지 지점 칸 목록 아래에, 검색어가 있을 때 은행연합회 점포 중 아직 매출처가 없는 곳을 최대 5줄 보여 준다.
//  - 업체(은행)를 먼저 골랐으면 그 은행 점포만. 고르면 그 자리에서 매출처로 등록(은행연합회 표기)하고 그 매출처를 쓴다.
//  - 등록은 주문 입력자 누구나(사용자 결정). 아르바이트는 신규 거래처 등록이 막혀 있어 안내만.
//  - 121 미적용이면 서버가 빈 목록을 돌려줘 아무것도 보이지 않는다.

export interface BankHit { id: string; group_name: string; display_name: string; full_name: string; address: string | null; phone: string | null }
export interface RegisteredBranch { vendor_id: string; group_id: string | null; name: string; existed: boolean }

export function BankBranchHits({ q, groupName, parttime, onRegistered, onError }: {
  q: string
  groupName: string | null
  parttime?: boolean
  onRegistered: (r: RegisteredBranch) => void
  onError?: (msg: string) => void
}) {
  const [items, setItems] = useState<BankHit[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const key = q.trim()
  useEffect(() => {
    // 업체를 안 골랐으면 두 글자부터(전 은행 검색), 골랐으면 한 글자부터
    if (key.length < (groupName ? 1 : 2)) { setItems([]); return }
    let alive = true
    const t = setTimeout(() => {
      fetch(`/api/orders-portal/masters?bank_q=${encodeURIComponent(key)}${groupName ? `&group_name=${encodeURIComponent(groupName)}` : ''}`)
        .then(r => (r.ok ? r.json() : { items: [] })).then(j => { if (alive) setItems(j.items ?? []) }).catch(() => { if (alive) setItems([]) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [key, groupName])
  if (!items.length) return null
  const pick = async (h: BankHit) => {
    setBusy(h.id)
    const res = await fetch('/api/orders-portal/masters', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register_bank_branch', branch_id: h.id }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { onError?.(j.error ?? '점포 등록 실패'); return }
    onRegistered(j as RegisteredBranch)
  }
  return (
    <div className="border-t border-gray-100 bg-blue-50/40">
      <div className="px-3 pt-1.5 pb-0.5 text-[0.6875rem] text-gray-500">
        미등록 점포(은행연합회) — {parttime ? '등록은 담당 직원에게 요청하세요' : '고르면 매출처로 등록하고 이 지점으로 씁니다'}
      </div>
      {items.map(h => (
        <button type="button" key={h.id} disabled={parttime || !!busy}
          onMouseDown={e => e.preventDefault()}
          onClick={() => pick(h)}
          className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-blue-50 disabled:hover:bg-transparent disabled:cursor-default flex items-baseline justify-between gap-2">
          <span>{busy === h.id ? '등록 중…' : h.full_name}</span>
          <span className="text-[0.6875rem] text-gray-400 truncate">{[h.address, h.phone].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
    </div>
  )
}
