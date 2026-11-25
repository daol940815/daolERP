'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// 매출처 상세 › 다른 매출처와 합치기 (2026-11-16 사용자 승인, 시안 docs/mockups/매출처_합치기_시안.html)
// 1) 대상 검색 · 남길 쪽 선택 → 2) 미리보기(건수 · 경고 · 막는 이유) → 3) 실행 → 같은 이름 담당자 합치기 안내
// 취소는 남은 매출처 상세 › 병합 이력(merge-history.tsx, 119).
interface Target { id: string; name: string; is_active: boolean; created_at: string; group_name: string | null }
interface Preview {
  from: { id: string; name: string }
  into: { id: string; name: string }
  counts: { key: string; label: string; from: number; into: number }[]
  warnings: string[]
  blockers: string[]
  same_name: { name: string; contacts: { contact_id: string; code: string | null; vendor_side: 'from' | 'into' }[] }[]
}

export default function MergeDialog({ vendorId, vendorName, onClose }: { vendorId: string; vendorName: string; onClose: () => void }) {
  const router = useRouter()
  const [step, setStep] = useState<'pick' | 'preview' | 'done'>('pick')
  const [q, setQ] = useState('')
  const [list, setList] = useState<Target[]>([])
  const [target, setTarget] = useState<Target | null>(null)
  const [keepThis, setKeepThis] = useState(true)
  const [pv, setPv] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [keepers, setKeepers] = useState<Record<string, string>>({})   // 같은 이름 → 남길 인물
  const [personDone, setPersonDone] = useState<Record<string, boolean>>({})
  const [undoable, setUndoable] = useState(false)   // 119 적용 = 병합 취소 가능

  useEffect(() => {
    if (step !== 'pick' || !q.trim()) { setList([]); return }
    const t = setTimeout(() => {
      fetch(`/api/vendor-hub/merge?q=${encodeURIComponent(q.trim())}&exclude=${vendorId}`)
        .then(r => r.json()).then(j => setList(j.vendors ?? [])).catch(() => setList([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, step, vendorId])

  const fromId = target ? (keepThis ? target.id : vendorId) : ''
  const intoId = target ? (keepThis ? vendorId : target.id) : ''

  const loadPreview = async () => {
    if (!target) return
    setBusy(true); setMsg(null)
    const res = await fetch(`/api/vendor-hub/merge?from=${fromId}&into=${intoId}`)
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(json.error ?? '미리보기 실패'); return }
    setPv(json); setStep('preview')
    setKeepers(Object.fromEntries((json.same_name ?? []).map((g: Preview['same_name'][number]) =>
      [g.name, (g.contacts.find(c => c.vendor_side === 'into') ?? g.contacts[0]).contact_id])))
  }
  const run = async () => {
    if (!pv) return
    if (!confirm(`'${pv.from.name}'을(를) '${pv.into.name}'(으)로 합칩니다.\n흡수된 쪽은 "병합됨"이 되고 이름은 별칭으로 남습니다. 진행할까요?`)) return
    setBusy(true); setMsg(null)
    const res = await fetch('/api/vendor-hub/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_id: pv.from.id, into_id: pv.into.id }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(json.error ?? '합치기 실패'); return }
    setUndoable(!!json.undoable)
    setStep('done')
  }
  const mergePeople = async (name: string, ids: string[]) => {
    const keep = keepers[name]
    if (!keep) return
    if (!confirm(`${name} 님 ${ids.length}건을 한 사람으로 합칩니다. 같은 분이 맞나요?`)) return
    setBusy(true); setMsg(null)
    for (const id of ids.filter(i => i !== keep)) {
      const res = await fetch('/api/contact-manager', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', source_id: id, target_id: keep }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(j.error ?? '인물 합치기 실패'); setBusy(false); return }
    }
    setBusy(false); setPersonDone(d => ({ ...d, [name]: true }))
  }

  const box = 'fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4'
  return (
    <div className={box} onClick={() => !busy && step !== 'done' && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        {step === 'pick' && (
          <>
            <h3 className="text-base font-bold text-slate-900">다른 매출처와 합치기</h3>
            <p className="text-xs text-slate-600 mt-0.5">같은 지점이 두 매출처로 나뉜 경우에 씁니다. 합친 뒤 한쪽은 &ldquo;병합됨&rdquo;이 되고 이름은 별칭으로 남습니다.</p>
            <label className="block text-xs text-slate-600 mt-4 mb-1">합칠 매출처 검색</label>
            <input autoFocus value={q} onChange={e => { setQ(e.target.value); setTarget(null) }} placeholder="이름 일부 (예: 올림픽선수촌)"
              className="w-full border border-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
            {!target && list.length > 0 && (
              <div className="mt-1 border border-slate-300 rounded-lg max-h-56 overflow-y-auto">
                {list.map(v => (
                  <button key={v.id} onClick={() => setTarget(v)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-200 last:border-0">
                    <b className="text-slate-900">{v.name}</b>
                    <span className="text-xs text-slate-500"> · {v.group_name ?? '업체 없음'} · {v.created_at} 등록{!v.is_active && ' · 비활성'}</span>
                  </button>
                ))}
              </div>
            )}
            {q.trim() && !target && !list.length && <p className="text-xs text-slate-500 mt-2">검색 결과 없음</p>}
            {target && (
              <div className="mt-4">
                <div className="text-xs text-slate-600 mb-1.5">어느 쪽을 남길까요? (남는 쪽의 이름 · 업체 · 사업자번호 · 청구처가 기준)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[{ keep: true, name: vendorName, sub: '지금 보고 있는 매출처' }, { keep: false, name: target.name, sub: `${target.group_name ?? '업체 없음'} · ${target.created_at} 등록` }].map(o => (
                    <button key={String(o.keep)} onClick={() => setKeepThis(o.keep)}
                      className={`text-left border rounded-lg px-3 py-2 ${keepThis === o.keep ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-300 hover:bg-slate-50'}`}>
                      <div className="text-sm font-bold text-slate-900">{o.name}</div>
                      <div className="text-xs text-slate-600">{o.sub}{keepThis === o.keep ? ' · 남김' : ' · 흡수'}</div>
                    </button>
                  ))}
                </div>
                <button onClick={() => setTarget(null)} className="mt-2 text-xs text-slate-600 underline">다른 매출처 고르기</button>
              </div>
            )}
            {msg && <p className="text-xs text-red-600 mt-3">{msg}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} className="px-3 py-1.5 border border-slate-400 rounded-lg text-sm text-slate-700">취소</button>
              <button disabled={!target || busy} onClick={loadPreview} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-40">
                {busy ? '확인 중...' : '미리보기'}
              </button>
            </div>
          </>
        )}

        {step === 'preview' && pv && (
          <>
            <h3 className="text-base font-bold text-slate-900">합치기 미리보기</h3>
            <p className="text-sm text-slate-700 mt-1">{pv.from.name} <b>→</b> <b>{pv.into.name}</b> <span className="text-slate-500">(남김)</span></p>
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                <th className="py-1.5 font-medium">항목</th><th className="py-1.5 font-medium text-right">옮겨지는 것</th><th className="py-1.5 font-medium text-right">남는 쪽에 이미</th>
              </tr></thead>
              <tbody>
                {pv.counts.filter(c => c.from > 0 || c.into > 0).map(c => (
                  <tr key={c.key} className="border-b border-slate-200">
                    <td className="py-1.5">{c.label}</td>
                    <td className={`py-1.5 text-right tabular-nums ${c.from > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>{c.from}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-600">{c.into}</td>
                  </tr>
                ))}
                <tr><td className="py-1.5" colSpan={3}><span className="text-xs text-slate-600">이름 &lsquo;{pv.from.name}&rsquo;은(는) 별칭으로 남아 이 이름으로 들어와도 남는 쪽으로 잡힙니다.</span></td></tr>
              </tbody>
            </table>
            {pv.same_name.length > 0 && (
              <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                같은 이름 담당자가 있습니다: {pv.same_name.map(g => `${g.name} 님(${g.contacts.map(c => c.code ?? '코드 없음').join(' · ')})`).join(', ')} —
                합친 뒤 같은 분이면 한 사람으로 합칠 수 있습니다(자동으로 합치지 않음).
              </div>
            )}
            {pv.warnings.map((w, i) => <div key={i} className="mt-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800">{w}</div>)}
            {pv.blockers.map((w, i) => <div key={i} className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{w}</div>)}
            {msg && <p className="text-xs text-red-600 mt-3">{msg}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button disabled={busy} onClick={() => setStep('pick')} className="px-3 py-1.5 border border-slate-400 rounded-lg text-sm text-slate-700">뒤로</button>
              <button disabled={busy || pv.blockers.length > 0} onClick={run} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-40">
                {busy ? '합치는 중...' : '합치기 실행'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && pv && (
          <>
            <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              <b>합쳤습니다.</b> {pv.from.name} → {pv.into.name} ·{' '}
              {pv.counts.filter(c => c.from > 0).map(c => `${c.label} ${c.from}`).join(' · ') || '옮길 연결 없음'}. 병합 이력에 남았습니다.
              {undoable && ' 잘못 합쳤으면 남은 매출처 상세의 "병합 이력"에서 취소할 수 있습니다.'}
            </div>
            {pv.same_name.length > 0 && (
              <div className="mt-3 border border-slate-300 rounded-lg p-3">
                <div className="text-sm font-bold text-slate-900">같은 이름 담당자 — 같은 분이면 합쳐 주세요</div>
                <p className="text-xs text-slate-600 mt-0.5">남길 분을 고르고 합치면 주문 · 상담 · 과거 매출 · 직함 이력이 그분으로 모이고, 같은 지점의 중복 배정 한 줄이 정리됩니다. 다른 분이면 그대로 두세요.</p>
                {pv.same_name.map(g => (
                  <div key={g.name} className="mt-2">
                    <div className="text-xs font-semibold text-slate-800">{g.name} 님</div>
                    {g.contacts.map(c => (
                      <label key={c.contact_id} className="flex items-center gap-2 text-xs py-0.5">
                        <input type="radio" disabled={personDone[g.name]} checked={keepers[g.name] === c.contact_id}
                          onChange={() => setKeepers(k => ({ ...k, [g.name]: c.contact_id }))} />
                        <span className="font-mono">{c.code ?? '코드 없음'}</span>
                        <span className="text-slate-500">{c.vendor_side === 'into' ? '남은 매출처의 기록' : '흡수된 매출처의 기록'}</span>
                        <a href={`/sales-hub/contacts/${c.contact_id}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">상세</a>
                      </label>
                    ))}
                    {personDone[g.name]
                      ? <div className="text-xs text-green-700 mt-1">한 사람으로 합쳤습니다.</div>
                      : <button disabled={busy} onClick={() => mergePeople(g.name, g.contacts.map(c => c.contact_id))}
                          className="mt-1 px-2.5 py-1 border border-violet-300 text-violet-700 rounded text-xs hover:bg-violet-50 disabled:opacity-40">선택한 분으로 한 사람 합치기</button>}
                  </div>
                ))}
              </div>
            )}
            {msg && <p className="text-xs text-red-600 mt-3">{msg}</p>}
            <div className="flex justify-end mt-5">
              <button onClick={() => { onClose(); router.push(`/sales-hub/${pv.into.id}`); router.refresh() }}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm">남은 매출처 상세로</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
