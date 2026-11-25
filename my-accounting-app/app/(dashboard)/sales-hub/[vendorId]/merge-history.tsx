'use client'

import { useCallback, useEffect, useState } from 'react'

import { btnCls } from '@/components/ui/kit'
// 매출처 상세 › 병합 이력 · 병합 취소 (119, 2026-11-18 사용자 승인)
// 이 매출처로 합쳐진 병합 목록을 보여 주고, 건별 기록이 있는 병합은 취소할 수 있다.
//  - 취소 = 병합 때 옮겨 온 건만 원래 매출처로 돌려보냄. 합친 뒤 새로 들어온 건은 이 매출처에 남는다.
//  - 건별 기록이 없는 예전 병합(119 이전)은 목록에만 보이고 취소할 수 없다.
interface HistoryRow {
  log_id: string; merged_at: string; actor: string | null
  from_id: string; from_name: string; moved_total: number
  snapshot_id: string | null; undone_at: string | null; undone_by: string | null
  can_undo: boolean; why_not: string | null
}
interface UndoPreview {
  snapshot_id: string
  from_id: string; from_name: string; into_name: string
  blockers: string[]
  counts: { table: string; label: string; total: number; back: number }[]
  staff_restore: number
  aliases_remove: string[]
  opening_from: number | null
  purchase_opening_from: number | null
  billing_children: number
}

const day = (s: string) => s.slice(0, 10)

export default function MergeHistoryDialog({ vendorId, vendorName, onClose, onChanged }: {
  vendorId: string; vendorName: string; onClose: () => void; onChanged: () => void
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [pv, setPv] = useState<UndoPreview | null>(null)
  const [done, setDone] = useState<UndoPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/vendor-hub/merge?history=${vendorId}`).then(r => r.json()).then(j => setRows(j.history ?? [])).catch(() => setRows([]))
  }, [vendorId])
  useEffect(() => { load() }, [load])

  const openPreview = async (snapshotId: string) => {
    setBusy(true); setMsg(null)
    const res = await fetch(`/api/vendor-hub/merge?undo_preview=${snapshotId}`)
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(json.error ?? '미리보기 실패'); return }
    setPv(json)
  }
  const run = async () => {
    if (!pv) return
    if (!confirm(`'${pv.from_name}' 병합을 취소합니다.\n병합 때 옮겨 온 건이 '${pv.from_name}'(으)로 돌아가고, 그 매출처가 다시 목록에 나타납니다. 진행할까요?`)) return
    setBusy(true); setMsg(null)
    const res = await fetch('/api/vendor-hub/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', snapshot_id: pv.snapshot_id }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setMsg(json.error ?? '병합 취소 실패'); return }
    setDone(pv); setPv(null); load(); onChanged()
  }

  const stay = pv ? pv.counts.reduce((a, c) => a + (c.total - c.back), 0) : 0
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        {!pv && (
          <>
            <h3 className="text-base font-bold text-slate-900">병합 이력</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              &lsquo;{vendorName}&rsquo;(으)로 합쳐진 매출처입니다. 잘못 합쳤으면 병합 취소로 다시 나눌 수 있습니다 — 병합 때 옮겨 온 건만 돌아가고, 합친 뒤 새로 들어온 건은 이 매출처에 남습니다.
            </p>
            {done && (
              <div className="mt-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                <b>병합을 취소했습니다.</b> {done.from_name} ·{' '}
                {done.counts.filter(c => c.back > 0).map(c => `${c.label} ${c.back}`).join(' · ') || '돌아간 연결 없음'}.{' '}
                <a href={`/sales-hub/${done.from_id}`} className="underline font-semibold">되살아난 매출처 보기</a>
              </div>
            )}
            {rows === null && <p className="text-sm text-slate-500 mt-4">불러오는 중...</p>}
            {rows !== null && rows.length === 0 && <p className="text-sm text-slate-500 mt-4">이 매출처로 합쳐진 기록이 없습니다.</p>}
            {rows !== null && rows.length > 0 && (
              <table className="w-full text-sm mt-3">
                <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                  <th className="py-1.5 font-medium">합친 날</th><th className="py-1.5 font-medium">흡수된 매출처</th>
                  <th className="py-1.5 font-medium text-right">옮긴 건</th><th className="py-1.5 font-medium">한 사람</th><th className="py-1.5" />
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.log_id} className="border-b border-slate-200 align-top">
                      <td className="py-1.5 tabular-nums whitespace-nowrap">{day(r.merged_at)}</td>
                      <td className="py-1.5">
                        <span className={r.undone_at ? 'text-slate-500 line-through' : 'text-slate-900 font-medium'}>{r.from_name}</span>
                        {r.undone_at && <div className="text-xs text-slate-600">{day(r.undone_at)} 취소됨{r.undone_by ? ` · ${r.undone_by}` : ''}</div>}
                        {!r.can_undo && !r.undone_at && <div className="text-xs text-slate-500">{r.why_not}</div>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-700">{r.moved_total.toLocaleString()}</td>
                      <td className="py-1.5 text-xs text-slate-600">{r.actor ?? '-'}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {r.can_undo && r.snapshot_id && (
                          <button disabled={busy} onClick={() => openPreview(r.snapshot_id!)}
                            className={btnCls('danger', 'sm')}>병합 취소</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {msg && <p className="text-xs text-red-600 mt-3">{msg}</p>}
            <div className="flex justify-end mt-5">
              <button onClick={onClose} className={btnCls('secondary', 'md')}>닫기</button>
            </div>
          </>
        )}

        {pv && (
          <>
            <h3 className="text-base font-bold text-slate-900">병합 취소 미리보기</h3>
            <p className="text-sm text-slate-700 mt-1"><b>{pv.from_name}</b> <span className="text-slate-500">(되살림)</span> <b>←</b> {pv.into_name}</p>
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                <th className="py-1.5 font-medium">항목</th><th className="py-1.5 font-medium text-right">병합 때 옮긴 것</th><th className="py-1.5 font-medium text-right">지금 돌아가는 것</th>
              </tr></thead>
              <tbody>
                {pv.counts.map(c => (
                  <tr key={c.table} className="border-b border-slate-200">
                    <td className="py-1.5">{c.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-600">{c.total}</td>
                    <td className={`py-1.5 text-right tabular-nums ${c.back > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
                      {c.back}{c.back < c.total && <span className="text-orange-600 font-normal text-xs"> ({c.total - c.back} 남음)</span>}
                    </td>
                  </tr>
                ))}
                {pv.counts.length === 0 && <tr><td colSpan={3} className="py-2 text-xs text-slate-500">옮겨 온 연결이 없는 병합입니다 — 매출처만 되살아납니다.</td></tr>}
              </tbody>
            </table>
            <ul className="mt-3 text-xs text-slate-700 space-y-1 list-disc pl-4">
              <li>&lsquo;{pv.from_name}&rsquo;이(가) 병합 전 상태로 되살아나 목록에 다시 나타납니다.</li>
              {pv.aliases_remove.length > 0 && <li>이 매출처의 별칭에서 {pv.aliases_remove.map(a => `'${a}'`).join(', ')}을(를) 뺍니다 — 그 이름은 다시 되살아난 매출처로 잡힙니다.</li>}
              {pv.staff_restore > 0 && <li>같은 직원이 양쪽 담당이어서 병합 때 정리된 지점 담당 {pv.staff_restore}줄을 되살립니다.</li>}
              {(pv.opening_from ?? 0) !== 0 && <li>합산했던 기초잔액 {Number(pv.opening_from).toLocaleString()}원을 되살아난 매출처로 돌려놓습니다.</li>}
              {(pv.purchase_opening_from ?? 0) !== 0 && <li>합산했던 매입 기초잔액 {Number(pv.purchase_opening_from).toLocaleString()}원을 돌려놓습니다.</li>}
              {pv.billing_children > 0 && <li>되살아난 매출처를 청구처로 두던 소속 부서 {pv.billing_children}곳이 다시 그쪽을 가리킵니다.</li>}
              <li>합친 뒤 이 매출처에 새로 들어온 주문 · 상담 · 입금 등은 이 매출처에 그대로 남습니다.</li>
            </ul>
            {stay > 0 && (
              <div className="mt-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800">
                병합 뒤에 다른 곳으로 옮겼거나 지운 {stay}건은 돌아가지 않습니다(그 뒤의 정리를 덮어쓰지 않습니다).
              </div>
            )}
            <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
              합치면서 &ldquo;한 사람으로 합치기&rdquo;를 한 담당자는 합쳐진 채로 남습니다 — 인물 병합은 이 취소로 되돌아가지 않습니다.
            </div>
            {pv.blockers.map((w, i) => <div key={i} className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{w}</div>)}
            {msg && <p className="text-xs text-red-600 mt-3">{msg}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button disabled={busy} onClick={() => { setPv(null); setMsg(null) }} className={btnCls('secondary', 'md')}>뒤로</button>
              <button disabled={busy || pv.blockers.length > 0} onClick={run} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm disabled:opacity-40">
                {busy ? '취소하는 중...' : '병합 취소 실행'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
