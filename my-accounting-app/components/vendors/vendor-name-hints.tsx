'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { GROUP_STANDARD_WHY, standardizeVendorInput, type VendorNameInput } from '@/lib/vendor-group-names'

// ─────────────────────────────────────────────────────────
// 업체명 자동 표준화 안내 (2026-11-19 사용자 승인, 시안 docs/mockups/업체명_자동표준화_시안.html)
// 매출처 등록 창 · 주문 입력 신규 지점 등록 · 상담일지 신규 매출처 등록이 함께 쓴다.
//   - 입력 칸 글자는 그대로 두고, 무엇이 무엇으로 바뀌는지 칸 아래에 보여 준다(즉시 — 규칙은 화면에서 계산).
//   - 연결될 업체 · 이미 있는 매출처는 서버에 묻는다(입력이 멈추면).
//   - 이미 있는 매출처면 부모 화면이 버튼을 "기존 매출처 사용"으로 바꾼다(existing).
// ─────────────────────────────────────────────────────────

export interface NameCheck {
  input: VendorNameInput
  group: { id: string; name: string; branch_count: number } | null
  existing: { id: string; name: string; group_id: string | null; is_active: boolean; via_alias: string | null } | null
  checked: boolean   // 서버 확인이 지금 입력 기준으로 끝났는지
}

// endpoint: 매출처 관리 = '/api/vendor-hub/name-check', 주문 · 상담 = '/api/orders-portal/masters?name_check=1'
export function useVendorNameCheck(endpoint: string, group: string, branch: string, opts?: { groupId?: string | null; groupName?: string | null; enabled?: boolean }): NameCheck {
  const enabled = opts?.enabled ?? true
  const groupId = opts?.groupId ?? null
  const input = useMemo(() => standardizeVendorInput(group, branch, groupId ? (opts?.groupName ?? null) : null), [group, branch, groupId, opts?.groupName])
  const [srv, setSrv] = useState<{ key: string; group: NameCheck['group']; existing: NameCheck['existing'] } | null>(null)
  const key = `${group}\u0000${branch}\u0000${groupId ?? ''}`
  useEffect(() => {
    if (!enabled || !(group.trim() || groupId)) { setSrv(null); return }
    let alive = true
    const t = setTimeout(() => {
      const sep = endpoint.includes('?') ? '&' : '?'
      const qs = `group=${encodeURIComponent(group)}&branch=${encodeURIComponent(branch)}${groupId ? `&group_id=${groupId}` : ''}`
      fetch(`${endpoint}${sep}${qs}`).then(r => r.ok ? r.json() : null).then(j => {
        if (alive && j) setSrv({ key, group: j.group ?? null, existing: j.existing ?? null })
      }).catch(() => {})
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [endpoint, group, branch, groupId, enabled, key])
  const fresh = srv?.key === key
  return { input, group: fresh ? srv!.group : null, existing: fresh ? srv!.existing : null, checked: fresh }
}

const box = 'mt-1.5 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed'

// 업체명 칸 아래 — 표준명으로 바뀜 / 'KB' 같은 안내만
export function GroupStdHint({ c, onSuggest }: { c: NameCheck; onSuggest?: (name: string) => void }) {
  const g = c.input.group
  if (g.changed) {
    return (
      <div className={`${box} bg-blue-50 border border-blue-200 text-blue-800`}>
        &lsquo;<b>{g.typed}</b>&rsquo;은(는) 표준 업체명 &lsquo;<b>{g.name}</b>&rsquo;(으)로 등록됩니다.{' '}
        <span className="underline cursor-help" title={GROUP_STANDARD_WHY}>왜 바뀌나요?</span>
      </div>
    )
  }
  if (c.input.hint) {
    const h = c.input.hint
    return (
      <div className={`${box} bg-amber-50 border border-amber-200 text-amber-800`}>
        <b>{h.suggest}</b>을(를) 찾으세요? <span className="text-amber-700">{h.why}</span>
        {onSuggest && (
          <button type="button" onClick={() => onSuggest(h.suggest)} className="ml-1.5 underline font-semibold">{h.suggest}(으)로 입력</button>
        )}
      </div>
    )
  }
  return null
}

// 지점명 칸 아래 — 앞의 은행명을 뗌
export function BranchStdHint({ c }: { c: NameCheck }) {
  const b = c.input.branch
  if (!b.stripped) return null
  return (
    <div className={`${box} bg-blue-50 border border-blue-200 text-blue-800`}>
      지점명 앞의 &lsquo;<span className="line-through text-slate-500">{b.stripped}</span>&rsquo;은(는) 업체명과 같아서 뺍니다
      {b.name ? <> → &lsquo;<b>{b.name}</b>&rsquo;</> : <> — 지점 없는 업체로 등록됩니다</>}
    </div>
  )
}

// 저장될 이름 미리보기 + 연결될 업체
export function NamePreview({ c, label = '등록될 매출처 이름' }: { c: NameCheck; label?: string }) {
  if (!c.input.fullName) return null
  return (
    <div className="text-xs text-slate-600 bg-slate-50 border border-dashed border-slate-400 rounded-lg px-3 py-2">
      {label} <b className="text-slate-900">{c.input.fullName}</b>
      {c.checked && (
        <span className="ml-1.5 inline-block rounded px-1.5 py-0.5 text-xs bg-slate-100 text-slate-700">
          {c.group ? `업체: ${c.group.name} (지점 ${c.group.branch_count.toLocaleString()}곳)` : `새 업체: ${c.input.group.name}`}
        </span>
      )}
    </div>
  )
}

// 이미 있는 매출처
// reuseInactive: 상담 · 주문 등록 — 비활성이면 저장할 때 서버가 다시 활성화해 쓴다(2026-11-19). 매출처관리 등록 창은 상세로 이동해 재활성.
export function ExistingVendorNote({ c, children, reuseInactive }: { c: NameCheck; children?: ReactNode; reuseInactive?: boolean }) {
  const e = c.existing
  if (!e) return null
  return (
    <div className={`${box} bg-amber-50 border border-amber-200 text-amber-800`}>
      이미 등록된 매출처가 있습니다 — <b>{e.name}</b>
      {e.via_alias && <span className="ml-1 inline-block rounded px-1.5 py-0.5 text-xs bg-slate-100 text-slate-700">옛 이름: {e.via_alias}</span>}
      {!e.is_active && <span className="ml-1 text-red-600">{reuseInactive ? '(비활성 — 사용하면 다시 활성화됩니다)' : '(비활성 — 상세에서 재활성하세요)'}</span>}
      <br />새로 만들지 않고 이 매출처를 씁니다. {children}
    </div>
  )
}
