'use client'

import { useCallback, useEffect, useState } from 'react'

import { btnCls } from '@/components/ui/kit'
// 매출처 상세 — 은행연합회 점포 정보 (121, 2026-11-23 · 시안 docs/mockups/은행점포_목록_시안.html 4번)
//  - 연결된 점포가 있으면 점포명 · 주소 · 전화(기준월)
//  - 은행 매출처인데 연결이 없으면 "점포 목록에 없음" + 비슷한 미연결 점포로 연결 / "점포 아님"(본점 부서 · 팀 · 모임) 표시
//  - 시스템은 추천만, 연결은 사용자가 누른다. 121 미적용이면 아무것도 보이지 않는다.
interface Br { id: string; base_month: string; branch_name: string; display_name: string; address: string | null; phone: string | null; group_name: string }
interface Info { available: boolean; branch: Br | null; is_bank: boolean; not_branch: boolean; suggestions: Br[]; can_edit?: boolean }

export function BankBranchCard({ vendorId }: { vendorId: string }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    fetch(`/api/vendor-hub/bank-branches?vendor_id=${vendorId}`).then(r => (r.ok ? r.json() : null)).then(setInfo).catch(() => setInfo(null))
  }, [vendorId])
  useEffect(() => { load() }, [load])
  if (!info?.available || !info.is_bank) return null
  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    const res = await fetch('/api/vendor-hub/bank-branches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { alert(j.error ?? '실패'); return }
    load()
  }
  const canEdit = !!info.can_edit
  if (info.branch) {
    const b = info.branch
    return (
      <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-slate-700">
        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">은행연합회 점포 {b.base_month}</span>
        <span className="text-slate-900">{b.branch_name}</span>
        {b.address && <span>· {b.address}</span>}
        {b.phone && <span>· {b.phone}</span>}
        {canEdit && (
          <button disabled={busy} onClick={() => { if (confirm('이 매출처와 점포의 연결을 풉니다. 매출처 · 주문은 그대로입니다. 진행할까요?')) post({ action: 'unlink', branch_id: b.id }) }}
            className="text-xs text-slate-500 hover:text-red-600 underline">연결 풀기</button>
        )}
      </div>
    )
  }
  if (info.not_branch) {
    return canEdit ? (
      <div className="mt-2 text-xs text-slate-500">
        점포 아님(부서 · 팀 · 모임)으로 표시됨 · <button disabled={busy} onClick={() => post({ action: 'not_branch', vendor_id: vendorId, value: false })} className="underline hover:text-slate-700">취소</button>
      </div>
    ) : null
  }
  return (
    <div className="mt-2 border border-amber-200 bg-amber-50 rounded-xl px-3 py-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">점포 목록에 없음</span>
        <span className="text-amber-900">은행연합회 점포 목록에서 찾지 못했습니다 — 폐점 · 통합 · 이름 변경이거나 점포가 아닌 곳일 수 있습니다.</span>
      </div>
      {canEdit && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {info.suggestions.map(s => (
            <button key={s.id} disabled={busy} onClick={() => post({ action: 'link', branch_id: s.id, vendor_id: vendorId })}
              className="px-2 py-0.5 border border-amber-300 bg-white rounded text-amber-900 hover:bg-amber-100">
              {s.group_name} {s.display_name}{s.address ? ` (${s.address})` : ''} 로 연결
            </button>
          ))}
          <button disabled={busy} onClick={() => post({ action: 'not_branch', vendor_id: vendorId, value: true })}
            className={btnCls('secondary', 'sm')}>점포 아님(부서 · 팀 · 모임)</button>
        </div>
      )}
    </div>
  )
}
