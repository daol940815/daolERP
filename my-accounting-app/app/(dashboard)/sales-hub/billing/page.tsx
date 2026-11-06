'use client'

// 청구처 지정 — 추천 확인 (114, 2026-11-06 사용자 승인 · 시안 docs/mockups/청구처_시안.html 4번)
// 시스템은 "본점 법인으로 계산서가 나갈 것 같은 매출처"를 추천만 한다. 맞는 것만 골라 확정하고,
// 자체 발행인 곳은 "아니다"로 확정해 다시 추천하지 않는다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface Suggestion {
  vendor_id: string; vendor_name: string; entity_id: string; entity_name: string; entity_biz: string | null
  group_name: string; staff: string | null; reasons: string[]; caution: string | null
}
interface Linked { vendor_id: string; vendor_name: string; entity_id: string; entity_name: string }
interface Bundle { available: boolean; suggestions: Suggestion[]; linked: Linked[]; self_count: number; can_edit?: boolean }

export default function BillingAssignPage() {
  const [b, setB] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [entity, setEntity] = useState<string>('')        // 칩: 청구처 법인 필터
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [view, setView] = useState<'suggest' | 'linked'>('suggest')
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/vendor-hub/billing')
    const json = await res.json().catch(() => null)
    if (res.ok && json) {
      setB(json)
      // 기본 선택 = 주의 표시 없는 추천
      setPicked(new Set((json.suggestions as Suggestion[]).filter(s => !s.caution).map(s => s.vendor_id)))
    } else flash(`조회 실패: ${json?.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const canEdit = !!b?.can_edit
  const entities = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>()
    for (const s of b?.suggestions ?? []) {
      const e = m.get(s.entity_id) ?? { id: s.entity_id, name: s.entity_name, n: 0 }
      e.n++; m.set(s.entity_id, e)
    }
    return Array.from(m.values()).sort((x, y) => y.n - x.n)
  }, [b])
  const rows = useMemo(() => (b?.suggestions ?? []).filter(s => !entity || s.entity_id === entity), [b, entity])
  const pickedRows = rows.filter(r => picked.has(r.vendor_id))

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/vendor-hub/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, json }
  }

  const confirmPicked = async () => {
    if (!pickedRows.length) return
    const byEntity = new Map<string, string[]>()
    for (const r of pickedRows) byEntity.set(r.entity_id, [...(byEntity.get(r.entity_id) ?? []), r.vendor_id])
    if (!confirm(`${pickedRows.length}곳의 청구처를 지정합니다.\n(${Array.from(byEntity.keys()).map(id => `${pickedRows.find(r => r.entity_id === id)?.entity_name} ${byEntity.get(id)!.length}곳`).join(' · ')})`)) return
    setBusy(true)
    let done = 0
    for (const [entityId, ids] of Array.from(byEntity.entries())) {
      const { ok, json } = await post({ action: 'set', vendor_ids: ids, billing_vendor_id: entityId })
      if (!ok) { flash(json.error ?? '지정 실패'); setBusy(false); load(); return }
      done += ids.length
    }
    setBusy(false); flash(`${done}곳 청구처 지정 완료`); load()
  }

  const markSelf = async (s: Suggestion) => {
    setBusy(true)
    const { ok, json } = await post({ action: 'self', vendor_ids: [s.vendor_id] })
    setBusy(false); flash(ok ? `${s.vendor_name} — 자체 발행으로 확정(다시 추천하지 않음)` : (json.error ?? '실패')); if (ok) load()
  }
  const clearLink = async (l: Linked) => {
    if (!confirm(`${l.vendor_name}의 청구처(${l.entity_name}) 지정을 해제할까요?\n해제하면 이 매출처가 직접 계산서를 받는 것으로 돌아가고, 다시 추천 목록에 나올 수 있습니다.`)) return
    setBusy(true)
    const { ok, json } = await post({ action: 'clear', vendor_ids: [l.vendor_id] })
    setBusy(false); flash(ok ? '해제했습니다.' : (json.error ?? '실패')); if (ok) load()
  }

  const tile = (on: boolean) => `text-left border rounded-xl px-4 py-3 bg-white transition-colors ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-gray-200 hover:bg-gray-50'}`

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-gray-400"><Link href="/sales-hub" className="hover:underline">매출처 관리 (지점)</Link> › 청구처 지정</div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">청구처 지정 — 추천 확인</h1>
          <p className="text-sm mt-1 text-gray-500">
            본점 법인 이름으로 계산서가 나가는 부서를 찾아 청구처로 연결합니다. 시스템은 추천만 합니다 — 맞는 것만 골라 확정하세요.
            부서는 매출처(고객)로 그대로 남고, 계산서 연결 · 미수금 대사만 청구처 기준으로 묶입니다.
          </p>
        </div>
        {canEdit && view === 'suggest' && (
          <button disabled={busy || !pickedRows.length} onClick={confirmPicked}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">
            선택 {pickedRows.length}곳 확정
          </button>
        )}
      </div>

      {msg && <div className="mt-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {loading ? <div className="text-center py-20 text-gray-400">로딩 중...</div>
        : !b ? <div className="text-center py-20 text-gray-400 text-sm">데이터를 불러오지 못했습니다.</div>
        : !b.available ? (
          <div className="mt-4 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
            마이그레이션 114(청구처)가 아직 실행되지 않았습니다. SQL 편집기에서 <b>114_vendor_billing_entity.sql</b>을 실행하면 이 화면이 열립니다.
          </div>
        ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 mb-4">
            <button onClick={() => setView('suggest')} className={tile(view === 'suggest')}>
              <p className="text-xs text-gray-400">추천 대기</p><p className="text-xl font-bold text-gray-900">{b.suggestions.length}</p>
              <p className="text-[0.6875rem] text-gray-400">기본 선택 {b.suggestions.filter(s => !s.caution).length} · 주의 {b.suggestions.filter(s => s.caution).length}</p>
            </button>
            <button onClick={() => setView('linked')} className={tile(view === 'linked')}>
              <p className="text-xs text-gray-400">청구처 지정됨</p><p className="text-xl font-bold text-gray-900">{b.linked.length}</p>
              <p className="text-[0.6875rem] text-gray-400">해제 가능</p>
            </button>
            <div className={tile(false)}>
              <p className="text-xs text-gray-400">자체 발행 확정</p><p className="text-xl font-bold text-gray-900">{b.self_count}</p>
              <p className="text-[0.6875rem] text-gray-400">다시 추천하지 않음</p>
            </div>
            <div className={tile(false)}>
              <p className="text-xs text-gray-400">청구처 법인</p><p className="text-xl font-bold text-gray-900">{new Set(b.linked.map(l => l.entity_id)).size}</p>
              <p className="text-[0.6875rem] text-gray-400">소속이 있는 법인</p>
            </div>
          </div>

          {view === 'suggest' ? (
            <>
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <button onClick={() => setEntity('')}
                  className={`px-2.5 py-1 text-xs rounded-full border ${!entity ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-300'}`}>
                  전체 {b.suggestions.length}
                </button>
                {entities.map(e => (
                  <button key={e.id} onClick={() => setEntity(entity === e.id ? '' : e.id)}
                    className={`px-2.5 py-1 text-xs rounded-full border ${entity === e.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-300'}`}>
                    {e.name} {e.n}
                  </button>
                ))}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                      <th className="py-2.5 px-3 w-8">
                        <input type="checkbox" disabled={!canEdit}
                          checked={rows.length > 0 && rows.every(r => picked.has(r.vendor_id))}
                          onChange={e => setPicked(p => { const n = new Set(p); rows.forEach(r => e.target.checked ? n.add(r.vendor_id) : n.delete(r.vendor_id)); return n })} />
                      </th>
                      <th className="py-2.5 px-3 font-medium">매출처(부서)</th>
                      <th className="py-2.5 px-3 font-medium">추천 청구처</th>
                      <th className="py-2.5 px-3 font-medium">추천 근거</th>
                      <th className="py-2.5 px-3 font-medium">담당 직원</th>
                      <th className="py-2.5 px-3 font-medium text-right">처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(s => (
                      <tr key={s.vendor_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3">
                          <input type="checkbox" disabled={!canEdit} checked={picked.has(s.vendor_id)}
                            onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(s.vendor_id); else n.delete(s.vendor_id); return n })} />
                        </td>
                        <td className="py-2 px-3"><Link href={`/sales-hub/${s.vendor_id}`} className="text-blue-700 hover:underline">{s.vendor_name}</Link></td>
                        <td className="py-2 px-3">{s.entity_name} <span className="text-[0.6875rem] text-gray-400">{s.entity_biz ?? ''}</span></td>
                        <td className="py-2 px-3">
                          <div className="flex flex-wrap gap-1">
                            {s.reasons.map(r => <span key={r} className="px-1.5 py-0.5 rounded text-[0.6875rem] bg-slate-100 text-slate-600">{r}</span>)}
                            {s.caution && <span className="px-1.5 py-0.5 rounded text-[0.6875rem] bg-amber-100 text-amber-700">{s.caution}</span>}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-600">{s.staff ?? '-'}</td>
                        <td className="py-2 px-3 text-right">
                          {canEdit && <button disabled={busy} onClick={() => markSelf(s)}
                            className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50">아니다(자체 발행)</button>}
                        </td>
                      </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={6} className="py-14 text-center text-gray-400 text-sm">추천할 매출처가 없습니다.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                추천 기준: 업체명과 같은 이름의 법인(사업자번호 · 매출 계산서 있음)이 있고, 그 업체 소속 매출처 중 자체 사업자번호와 자체 계산서가 모두 없는 곳.
                이름이 지점 · 출장소 · 센터면 자체 발행일 수 있어 기본 선택하지 않습니다. 목록에 없는 매출처는 그 매출처 상세에서 직접 지정할 수 있습니다.
              </p>
            </>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                    <th className="py-2.5 px-3 font-medium">청구처 법인</th>
                    <th className="py-2.5 px-3 font-medium">매출처(부서)</th>
                    <th className="py-2.5 px-3 font-medium text-right">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {b.linked.map(l => (
                    <tr key={l.vendor_id} className="border-b border-gray-100">
                      <td className="py-2 px-3"><Link href={`/sales-hub/${l.entity_id}`} className="text-blue-700 hover:underline">{l.entity_name}</Link></td>
                      <td className="py-2 px-3"><Link href={`/sales-hub/${l.vendor_id}`} className="text-blue-700 hover:underline">{l.vendor_name}</Link></td>
                      <td className="py-2 px-3 text-right">
                        {canEdit && <button disabled={busy} onClick={() => clearLink(l)}
                          className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50">해제</button>}
                      </td>
                    </tr>
                  ))}
                  {!b.linked.length && <tr><td colSpan={3} className="py-14 text-center text-gray-400 text-sm">아직 청구처가 지정된 매출처가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
