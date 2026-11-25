'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

import { btnCls, fieldBox } from '@/components/ui/kit'
// 매출처 하위 조직 · 위치 (120, 2026-11-20 사용자 승인 — 시안 docs/mockups/매출처_하위조직_시안.html)
//  - OrgHeader: 경로(업체 › 상위들 › 이 조직) · 위치 배지 · 상위 조직/위치 변경 · 하위 조직 추가 · 집계 범위(이 조직만 / 하위 포함)
//  - OrgTab: 하위 조직 트리(숫자 포함) · 새 하위 조직 등록 · 기존 매출처 편입 · 하위에서 빼기 · 변경 이력
//  - 이름 규칙(사용자 결정): 업체명 + 상위 단위 + 팀명 — '하나은행 원큐 자동차금융팀'. 편입할 때 규칙에 안 맞으면 새 이름을 제안(옛 이름은 별칭).
//  - 청구처(계산서 법인, '소속 부서' 탭)와는 다른 개념이다.

export interface OrgTotals { net: number; outstanding: number; order_count: number; contacts: number }
export interface OrgRow {
  id: string; name: string; unit: string; depth: number; is_self: boolean; is_active: boolean
  location_name: string | null; contact_rep: string | null; contacts: number; staff_primary: string | null
  net: number; outstanding: number; order_count: number
}
export interface OrgData {
  available: boolean
  path: { id: string; name: string; unit: string }[]
  group: { id: string; name: string } | null
  parent: { id: string; name: string } | null
  location: { id: string; name: string } | null
  unit: string
  rows: OrgRow[]
  child_count: number
  totals: { self: OrgTotals; subtree: OrgTotals }
  changes: { field: string; old_name: string | null; new_name: string | null; changed_by_name: string | null; changed_at: string }[]
  can_edit: boolean
  located?: LocatedRow[]
}
export interface LocatedRow {
  id: string; name: string; path: string; depth: number
  contact_rep: string | null; contacts: number; net: number; outstanding: number; order_count: number
}

export function useOrg(vendorId: string, from: string, to: string) {
  const [org, setOrg] = useState<OrgData | null>(null)
  const load = useCallback(() => {
    fetch(`/api/vendor-hub/org?vendor_id=${vendorId}&from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null).then(j => setOrg(j)).catch(() => setOrg(null))
  }, [vendorId, from, to])
  useEffect(() => { load() }, [load])
  return { org, reload: load }
}

const won = (n: number) => n.toLocaleString('ko-KR')
export type OrgMode = null | 'set' | 'create' | 'attach'
type Mode = OrgMode

// part = 'crumb' (제목 위 경로) | 'rest' (제목 아래 — 위치 · 버튼 · 집계 범위)
export function OrgHeader({ org, vendorName, onEdit, scope, setScope, part }: {
  org: OrgData; vendorName: string
  onEdit: (m: Mode) => void
  scope: 'self' | 'subtree'; setScope: (s: 'self' | 'subtree') => void
  part: 'crumb' | 'rest'
}) {
  if (!org.available) return null
  const t = scope === 'subtree' ? org.totals.subtree : org.totals.self
  if (part === 'crumb') {
    if (!org.path.length) return null   // 상위 조직이 없으면 경로를 따로 보이지 않는다(지금과 같은 화면)
  }
  return (
    <div className="mb-1">
      {part === 'crumb' && (
        <div className="text-xs text-slate-600 flex items-center gap-1 flex-wrap">
          {/* 맨 위 상위 조직이 업체명과 같은 이름(업체 메인 매출처)이면 업체 이름을 따로 쓰지 않고 그 링크 하나만 보인다(2026-11-24) */}
          {org.group && org.path[0]?.unit.replace(/\s+/g, '') !== org.group.name.replace(/\s+/g, '') && <span>{org.group.name}</span>}
          {org.path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              {(i > 0 || (org.group && p.unit.replace(/\s+/g, '') !== org.group.name.replace(/\s+/g, ''))) && <span className="text-slate-400">›</span>}
              <Link href={`/sales-hub/${p.id}`} className="text-blue-700 hover:underline">{p.unit}</Link>
            </span>
          ))}
          <span className="text-slate-400">›</span><b className="text-slate-900">{org.unit || vendorName}</b>
        </div>
      )}
      {part === 'rest' && <>
      <div className="flex items-center gap-1.5 flex-wrap mt-1">
        {org.location && (
          <Link href={`/sales-hub/${org.location.id}`} className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 hover:underline">
            위치: {org.location.name}
          </Link>
        )}
        {org.can_edit && (
          <>
            <button onClick={() => onEdit('set')} className={btnCls('secondary', 'sm')}>상위 조직 · 위치</button>
            <button onClick={() => onEdit('create')} className={btnCls('secondary', 'sm')}>하위 조직 추가</button>
          </>
        )}
      </div>
      {!!org.located?.length && <LocatedBox rows={org.located} />}
      {org.child_count > 0 && (
        <div className="mt-2 flex items-center gap-3 flex-wrap bg-white border border-slate-300 rounded-xl px-3 py-2">
          <span className="text-xs text-slate-600">집계 범위</span>
          <span className="inline-flex border border-slate-400 rounded-lg overflow-hidden">
            <button onClick={() => setScope('self')} className={`px-2.5 py-1 text-xs ${scope === 'self' ? 'bg-slate-900 text-white font-bold' : 'bg-white text-slate-700'}`}>이 조직만</button>
            <button onClick={() => setScope('subtree')} className={`px-2.5 py-1 text-xs ${scope === 'subtree' ? 'bg-slate-900 text-white font-bold' : 'bg-white text-slate-700'}`}>하위 포함 ({org.child_count})</button>
          </span>
          <span className="text-xs text-slate-700">기간 매출 <b className="text-slate-900 tabular-nums">{won(t.net)}</b></span>
          <span className="text-xs text-slate-700">미수 <b className={`tabular-nums ${t.outstanding > 0 ? 'text-red-600' : 'text-slate-900'}`}>{won(t.outstanding)}</b></span>
          <span className="text-xs text-slate-700">주문 <b className="text-slate-900 tabular-nums">{t.order_count}</b>건</span>
          <span className="text-xs text-slate-700">현재 담당자 <b className="text-slate-900 tabular-nums">{t.contacts}</b>명</span>
          <span className="text-xs text-slate-500">각 조직 숫자는 &lsquo;하위 조직&rsquo; 탭에서 · 아래 카드 · 탭은 이 조직 기준</span>
        </div>
      )}
      </>}
    </div>
  )
}

// 이 지점에 있는 조직 (2026-11-20) — 위치(자리)만 같고 소속은 다르다. 숫자는 참고용이며 이 매출처의 집계에 더하지 않는다.
function LocatedBox({ rows }: { rows: LocatedRow[] }) {
  const [open, setOpen] = useState(false)
  const sum = rows.reduce((a, r) => ({ net: a.net + r.net, outstanding: a.outstanding + r.outstanding }), { net: 0, outstanding: 0 })
  return (
    <div className="mt-2 bg-white border border-slate-300 rounded-xl">
      <button onClick={() => setOpen(o => !o)} className="w-full px-3 py-2 flex items-center gap-2 flex-wrap text-left">
        <span className="text-xs font-bold text-slate-800">이 지점에 있는 조직 {rows.length}</span>
        <span className="text-xs text-slate-700 truncate">{rows.filter(r => r.depth === 0).map(r => r.path).join(' · ')}{rows.some(r => r.depth > 0) ? ` 외 하위 ${rows.filter(r => r.depth > 0).length}` : ''}</span>
        <span className="text-xs text-slate-500">소속이 달라 이 지점 집계에는 들어가지 않습니다</span>
        <span className="ml-auto text-xs text-blue-700">{open ? '접기' : '목록 보기'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-slate-200">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs border-b border-slate-300">
                <th className="py-2 px-3 text-left font-medium">조직 (소속 경로)</th>
                <th className="py-2 px-3 text-left font-medium">대표 담당자</th>
                <th className="py-2 px-3 text-right font-medium">담당자</th>
                <th className="py-2 px-3 text-right font-medium">기간 매출</th>
                <th className="py-2 px-3 text-right font-medium">미수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="py-1.5 px-3">
                    <span style={{ paddingLeft: `${r.depth * 1.1}rem` }} className="inline-flex items-center gap-1">
                      {r.depth > 0 && <span className="text-slate-400">└</span>}
                      <Link href={`/sales-hub/${r.id}`} className="text-slate-900 hover:underline">{r.path}</Link>
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-xs text-slate-800">{r.contact_rep ?? <span className="text-slate-400">-</span>}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{r.contacts}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{won(r.net)}</td>
                  <td className={`py-1.5 px-3 text-right tabular-nums ${r.outstanding > 0 ? 'text-red-600' : 'text-slate-500'}`}>{won(r.outstanding)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td className="py-1.5 px-3 text-xs text-slate-600" colSpan={3}>참고 합계 (이 지점 숫자와 별도)</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{won(sum.net)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{won(sum.outstanding)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function OrgTab({ org, onEdit, onChanged }: {
  org: OrgData; onEdit: (m: Mode) => void; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const detach = async (r: OrgRow) => {
    if (!confirm(`'${r.name}'을(를) 하위 조직에서 뺍니다(업체 바로 아래로). 주문 · 담당자는 그대로입니다. 진행할까요?`)) return
    setBusy(true)
    const res = await fetch('/api/vendor-hub/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', vendor_id: r.id, parent_id: null }) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { alert(j.error ?? '실패'); return }
    onChanged()
  }
  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-300 rounded-xl overflow-x-auto">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-900">하위 조직 {org.child_count}</span>
          <span className="text-xs text-slate-500">주문 · 계산서 · 담당자는 각 조직에 붙습니다 — 행을 누르면 그 조직 상세</span>
          {org.can_edit && (
            <span className="ml-auto flex gap-1.5">
              <button onClick={() => onEdit('create')} className={btnCls('primary', 'sm')}>새 하위 조직 등록</button>
              <button onClick={() => onEdit('attach')} className={btnCls('secondary', 'sm')}>기존 매출처 편입</button>
            </span>
          )}
        </div>
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-xs border-y border-slate-300">
              <th className="py-2 px-3 text-left font-medium">조직</th>
              <th className="py-2 px-3 text-left font-medium">위치</th>
              <th className="py-2 px-3 text-left font-medium">대표 담당자</th>
              <th className="py-2 px-3 text-right font-medium">담당자</th>
              <th className="py-2 px-3 text-right font-medium">기간 매출</th>
              <th className="py-2 px-3 text-right font-medium">미수</th>
              <th className="py-2 px-3 text-left font-medium">다올 담당</th>
              {org.can_edit && <th className="py-2 px-3" />}
            </tr>
          </thead>
          <tbody>
            {org.rows.map(r => (
              <tr key={r.id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="py-1.5 px-3">
                  <span style={{ paddingLeft: `${r.depth * 1.1}rem` }} className="inline-flex items-center gap-1">
                    {r.depth > 0 && <span className="text-slate-400">└</span>}
                    {r.is_self
                      ? <b className="text-slate-900">{r.unit}</b>
                      : <Link href={`/sales-hub/${r.id}`} className="text-slate-900 hover:underline">{r.unit}</Link>}
                    {r.is_self && <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-600">이 조직</span>}
                    {!r.is_active && <span className="px-1.5 py-0.5 rounded text-xs bg-slate-200 text-slate-700">비활성</span>}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-xs">{r.location_name ? <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{r.location_name}</span> : <span className="text-slate-400">-</span>}</td>
                <td className="py-1.5 px-3 text-xs text-slate-800">{r.contact_rep ?? <span className="text-slate-400">-</span>}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{r.contacts}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{won(r.net)}</td>
                <td className={`py-1.5 px-3 text-right tabular-nums ${r.outstanding > 0 ? 'text-red-600' : 'text-slate-500'}`}>{won(r.outstanding)}</td>
                <td className="py-1.5 px-3 text-xs text-slate-700">{r.staff_primary ?? '-'}</td>
                {org.can_edit && (
                  <td className="py-1.5 px-3 text-right">
                    {!r.is_self && r.depth === 1 && (
                      <button disabled={busy} onClick={() => detach(r)} className="text-xs text-slate-600 hover:text-red-600 underline">빼기</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td className="py-1.5 px-3 text-xs text-slate-700" colSpan={3}>합계 (하위 포함)</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{org.totals.subtree.contacts}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{won(org.totals.subtree.net)}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{won(org.totals.subtree.outstanding)}</td>
              <td colSpan={org.can_edit ? 2 : 1} />
            </tr>
          </tbody>
        </table>
      </div>
      {org.changes.length > 0 && (
        <div className="bg-white border border-slate-300 rounded-xl px-4 py-3">
          <div className="text-xs font-bold text-slate-800 mb-1">상위 조직 · 위치 변경 이력 (이 조직)</div>
          {org.changes.map((c, i) => (
            <div key={i} className="text-xs text-slate-700 py-0.5">
              {c.changed_at.slice(0, 10)} · {c.field === 'parent' ? '상위 조직' : '위치'} {c.old_name ?? '(없음)'} → <b>{c.new_name ?? '(없음)'}</b>{c.changed_by_name ? ` · ${c.changed_by_name}` : ''}
            </div>
          ))}
        </div>
      )}
      {!org.child_count && <p className="text-xs text-slate-500 px-1">하위 조직이 없습니다. 팀 · 부서를 &ldquo;새 하위 조직 등록&rdquo;으로 만들거나, 이미 있는 매출처를 &ldquo;기존 매출처 편입&rdquo;으로 이 조직 아래에 넣으세요.</p>}
      <p className="text-xs text-slate-500 px-1">이 조직 자체를 다른 조직 아래로 넣으려면 위의 &ldquo;상위 조직 · 위치&rdquo;를 쓰세요. 새 상위 조직이 필요하면 매출처를 먼저 등록한 뒤 거기서 이 조직을 편입하면 됩니다.</p>
    </div>
  )
}

interface Cand { id: string; name: string; path?: string; children?: number }

function SearchPick({ kind, vendorId, value, onPick, placeholder }: {
  kind: 'parent' | 'child' | 'location'; vendorId: string; value: Cand | null; onPick: (c: Cand | null) => void; placeholder: string
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Cand[]>([])
  useEffect(() => {
    if (value) return
    const t = setTimeout(() => {
      fetch(`/api/vendor-hub/org?candidates=${kind}&vendor_id=${vendorId}&q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json()).then(j => setItems(j.items ?? [])).catch(() => setItems([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, kind, vendorId, value])
  if (value) {
    return (
      <div className="flex items-center justify-between text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
        <span><b className="text-blue-900">{value.name}</b>{value.path && <span className="text-xs text-blue-700 ml-1.5">{value.path}</span>}</span>
        <button onClick={() => onPick(null)} className="text-xs text-blue-700 underline">변경</button>
      </div>
    )
  }
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder}
        className={fieldBox()} />
      {(q.trim() || kind !== 'location') && (
        <div className="mt-1 border border-slate-300 rounded-lg max-h-48 overflow-y-auto">
          {items.length === 0 && <p className="text-xs text-slate-500 px-3 py-2">{q.trim() ? '검색 결과 없음' : '이름 일부를 입력하세요'}</p>}
          {items.map(c => (
            <button key={c.id} onClick={() => onPick(c)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 border-b border-slate-200 last:border-0">
              <span className="text-slate-900">{c.name}</span>
              {c.path && <span className="block text-xs text-slate-500">{c.path}{c.children ? ` · 하위 ${c.children}` : ''}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function OrgDialog({ mode, org, vendorId, vendorName, onClose, onDone }: {
  mode: Exclude<Mode, null>; org: OrgData; vendorId: string; vendorName: string; onClose: () => void; onDone: (newVendorId?: string) => void
}) {
  const [parent, setParent] = useState<Cand | null>(mode === 'set' && org.parent ? { id: org.parent.id, name: org.parent.name } : null)
  const [noParent, setNoParent] = useState(false)
  const [location, setLocation] = useState<Cand | null>(mode === 'set' && org.location ? { id: org.location.id, name: org.location.name } : null)
  const [child, setChild] = useState<Cand | null>(null)
  const [unit, setUnit] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [useRename, setUseRename] = useState(true)
  const [renameText, setRenameText] = useState('')   // 제안 이름을 고쳐 쓸 수 있게
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // 이름 규칙 제안: 상위를 바꾸는 매출처(set = 이 매출처, attach = 고른 매출처)
  const renameTarget = mode === 'set' ? vendorId : child?.id ?? null
  const renameParent = mode === 'set' ? (noParent ? null : parent?.id ?? null) : vendorId
  useEffect(() => {
    if (!renameTarget || mode === 'create') { setRename(null); return }
    fetch(`/api/vendor-hub/org?rename_for=${renameTarget}&parent_id=${renameParent ?? ''}`)
      .then(r => r.json()).then(j => { setRename(j.name ?? null); setRenameText(j.name ?? '') }).catch(() => setRename(null))
  }, [renameTarget, renameParent, mode])

  const parentUnit = org.unit || vendorName
  const createPreview = unit.trim() ? [org.group?.name, unit.trim().replace(/\s+/g, '').startsWith(parentUnit.replace(/\s+/g, '')) ? '' : parentUnit, unit.trim()].filter(Boolean).join(' ') : ''

  const save = async () => {
    setBusy(true); setMsg(null)
    let body: Record<string, unknown>
    if (mode === 'set') body = { action: 'set', vendor_id: vendorId, parent_id: noParent ? null : parent?.id ?? null, location_id: location?.id ?? null, rename: useRename ? (renameText.trim() || rename) : null }
    else if (mode === 'attach') {
      if (!child) { setBusy(false); setMsg('편입할 매출처를 고르세요.'); return }
      body = { action: 'set', vendor_id: child.id, parent_id: vendorId, ...(location ? { location_id: location.id } : {}), rename: useRename ? (renameText.trim() || rename) : null }
    } else {
      if (!unit.trim()) { setBusy(false); setMsg('조직 이름(팀명)을 입력하세요.'); return }
      body = { action: 'create_child', parent_id: vendorId, unit: unit.trim(), location_id: location?.id ?? null }
    }
    const res = await fetch('/api/vendor-hub/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(j.error ?? '저장 실패'); return }
    onDone(j.vendor_id)
  }

  const title = mode === 'set' ? `상위 조직 · 위치 — ${vendorName}` : mode === 'attach' ? `기존 매출처를 하위로 편입 — ${vendorName} 아래` : `새 하위 조직 — ${vendorName} 아래`
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-600 mt-0.5">팀도 매출처 하나입니다(주문 · 담당자가 붙는 곳). 상위 조직은 같은 업체 안에서만 고를 수 있습니다. 청구처(계산서 법인)와는 별개입니다.</p>

        {mode === 'set' && (
          <>
            <label className="block text-xs font-medium text-slate-800 mt-4 mb-1">상위 조직</label>
            {noParent
              ? <div className="flex items-center justify-between text-sm bg-slate-50 border border-slate-300 rounded-lg px-3 py-2"><span>업체 바로 아래 (상위 없음)</span><button onClick={() => setNoParent(false)} className="text-xs underline text-slate-700">상위 고르기</button></div>
              : <SearchPick kind="parent" vendorId={vendorId} value={parent} onPick={setParent} placeholder="상위 조직 이름 일부 (예: 원큐 · 본점)" />}
            {!noParent && <button onClick={() => { setNoParent(true); setParent(null) }} className="mt-1 text-xs text-slate-600 underline">상위 없이 업체 바로 아래로</button>}
          </>
        )}
        {mode === 'attach' && (
          <>
            <label className="block text-xs font-medium text-slate-800 mt-4 mb-1">편입할 매출처 (같은 업체)</label>
            <SearchPick kind="child" vendorId={vendorId} value={child} onPick={setChild} placeholder="매출처 이름 일부 (예: 자동차금융)" />
          </>
        )}
        {mode === 'create' && (
          <>
            <label className="block text-xs font-medium text-slate-800 mt-4 mb-1">조직 이름 (팀 · 부서명)</label>
            <input autoFocus value={unit} onChange={e => setUnit(e.target.value)} placeholder="예: 자동차금융팀"
              className={fieldBox()} />
            {createPreview && (
              <div className="mt-2 text-xs text-slate-600 bg-slate-50 border border-dashed border-slate-400 rounded-lg px-3 py-2">
                등록될 매출처 이름 <b className="text-slate-900">{createPreview}</b> <span className="text-slate-500">(업체명 + 상위 단위 + 팀명)</span>
              </div>
            )}
          </>
        )}

        <label className="block text-xs font-medium text-slate-800 mt-4 mb-1">위치(소재 지점) <span className="font-normal text-slate-500">— 상위 조직과 다른 곳에 있을 때만</span></label>
        <SearchPick kind="location" vendorId={mode === 'attach' && child ? child.id : vendorId} value={location} onPick={setLocation} placeholder="비우면 상위 조직과 같은 곳 (예: 서면역)" />

        {mode !== 'create' && rename && (
          <label className="mt-4 flex items-start gap-2 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-900">
            <input type="checkbox" checked={useRename} onChange={e => setUseRename(e.target.checked)} className="mt-0.5" />
            <span className="flex-1">이름도 규칙에 맞춰 바꾸기 (고쳐 쓸 수 있음)
              <input value={renameText} disabled={!useRename} onChange={e => setRenameText(e.target.value)}
                className="mt-1 w-full border border-blue-200 rounded px-2 py-1 text-sm text-slate-900 bg-white disabled:opacity-50" />
              <span className="text-blue-700">업체명 + 상위 단위 + 팀명. 옛 이름은 별칭으로 남아 계산서 · ERP 표기 연결은 그대로입니다.</span></span>
          </label>
        )}

        {msg && <p className="text-xs text-red-600 mt-3">{msg}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button disabled={busy} onClick={onClose} className={btnCls('secondary', 'md')}>취소</button>
          <button disabled={busy} onClick={save} className={btnCls('primary', 'md')}>
            {busy ? '저장 중...' : mode === 'create' ? '등록' : mode === 'attach' ? '편입' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
