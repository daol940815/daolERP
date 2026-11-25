'use client'

// 비활성 매출처 검색 결과 (2026-11-19 사용자 원칙: 같은 이름의 매출처는 활성 · 비활성을 통틀어 하나만)
//  - 상담일지 · 주문서의 지점 칸 목록 아래에, 검색어(2글자 이상)가 있을 때만 회색으로 보여 준다(기본 목록에는 활성만).
//  - 고르면 그 자리에서 다시 활성화하고(`reactivate_vendor`) 그 매출처를 쓴다 — 같은 이름의 새 매출처를 만들지 않도록.
//  - 같은 이름의 활성 매출처가 있는 비활성 매출처는 보이지 않는다(중복 정리 전까지의 안전장치 — 정리 대상은 합치기로).
//  - 아르바이트는 등록 · 활성화를 못 하므로 안내만.

export interface InactiveVendor { id: string; name: string; group_id: string | null }

// 매출처 이름 비교 키 — lib/vendor-name-check.ts `vendorKey`와 같은 규칙(법인 표기 · 공백 · 대소문자 무시)
const keyOf = (s: string) => s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '').replace(/\s+/g, '').toLowerCase()

export function matchInactiveVendors(q: string, items: InactiveVendor[], opts: {
  activeNames: string[]; groupId?: string | null; groupName?: string | null; limit?: number
}): InactiveVendor[] {
  const k = keyOf(q)
  if (k.length < 2) return []
  const active = new Set(opts.activeNames.map(keyOf))
  const gk = opts.groupName ? keyOf(opts.groupName) : ''
  return items
    .filter(v => keyOf(v.name).includes(k) && !active.has(keyOf(v.name)))
    .filter(v => !opts.groupId || v.group_id === opts.groupId || (!v.group_id && !!gk && keyOf(v.name).startsWith(gk)))
    .slice(0, opts.limit ?? 8)
}

export async function reactivateVendor(vendorId: string): Promise<{ vendor_id: string; group_id: string | null; name: string } | { error: string }> {
  const res = await fetch('/api/orders-portal/masters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reactivate_vendor', vendor_id: vendorId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json.error ?? '활성화 실패' }
  return json
}

export function InactiveVendorHits({ hits, parttime, busy, onPick }: {
  hits: InactiveVendor[]
  parttime?: boolean
  busy?: boolean
  onPick: (v: InactiveVendor) => void
}) {
  if (!hits.length) return null
  return (
    <div className="border-t border-slate-200 bg-slate-50/60">
      <div className="px-3 pt-1.5 pb-0.5 text-xs text-slate-600">
        비활성 매출처 — {parttime ? '다시 사용하려면 담당 직원에게 요청하세요' : '고르면 다시 사용(활성화)합니다'}
      </div>
      {hits.map(v => (
        <button type="button" key={v.id} disabled={parttime || busy}
          onMouseDown={e => e.preventDefault()}
          onClick={() => onPick(v)}
          className="w-full text-left px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:hover:bg-transparent disabled:cursor-default">
          {v.name}
          <span className="ml-1.5 inline-block rounded px-1 py-0.5 text-xs bg-slate-200 text-slate-700 align-middle">비활성</span>
        </button>
      ))}
    </div>
  )
}
