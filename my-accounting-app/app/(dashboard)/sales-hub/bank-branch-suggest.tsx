'use client'

import { useEffect, useState } from 'react'
import { standardizeGroupName } from '@/lib/vendor-group-names'

// 매출처 등록 창 — 지점명 아래 은행연합회 미등록 점포 (121, 2026-11-23 · 시안 docs/mockups/은행점포_목록_시안.html 3번)
// 업체가 은행이면 지점명으로 그 은행 점포를 찾아 보여 주고, 고르면 은행연합회 표기 · 주소 · 전화로 바로 등록한다.
// 목록에 없는 곳(본점 부서 · 팀 · 모임)은 지금처럼 직접 입력해 "등록".
interface Hit { id: string; full_name: string; address: string | null; phone: string | null }

export function BankBranchSuggest({ group, branch, onRegistered, onError }: {
  group: string; branch: string; onRegistered: (vendorId: string) => void; onError: (m: string) => void
}) {
  const [items, setItems] = useState<Hit[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const g = standardizeGroupName(group).name
  const k = branch.trim()
  useEffect(() => {
    if (!g || !k) { setItems([]); return }
    let alive = true
    const t = setTimeout(() => {
      fetch(`/api/vendor-hub/bank-branches?search=${encodeURIComponent(k)}&group=${encodeURIComponent(g)}`)
        .then(r => (r.ok ? r.json() : { items: [] })).then(j => { if (alive) setItems(j.items ?? []) }).catch(() => { if (alive) setItems([]) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [g, k])
  if (!items.length) return null
  const pick = async (h: Hit) => {
    setBusy(h.id)
    const res = await fetch('/api/vendor-hub/bank-branches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', branch_id: h.id }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { onError(j.error ?? '점포 등록 실패'); return }
    onRegistered(j.vendor_id)
  }
  return (
    <div className="mt-1.5 border border-blue-200 rounded-lg bg-blue-50/50">
      <div className="px-2.5 pt-1.5 pb-0.5 text-xs text-blue-800">은행연합회 점포 — 고르면 이 이름 · 주소 · 전화로 바로 등록합니다</div>
      {items.map(h => (
        <button type="button" key={h.id} disabled={!!busy} onClick={() => pick(h)}
          className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-blue-100 disabled:opacity-60 flex items-baseline justify-between gap-2">
          <span className="text-slate-900">{busy === h.id ? '등록 중…' : h.full_name}</span>
          <span className="text-xs text-slate-600 truncate">{[h.address, h.phone].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
    </div>
  )
}
