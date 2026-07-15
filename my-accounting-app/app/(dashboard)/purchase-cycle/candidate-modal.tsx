'use client'

import { useEffect, useState } from 'react'

interface CandInvoice { id: string; issue_date: string; item_name: string | null; total_amount: number; remaining: number }
interface CandTx { id: string; tx_date: string; tx_time?: string | null; description: string | null; amount_out: number; remaining: number }
interface CandGroup {
  type: string; label: string
  invoices: CandInvoice[]; txs: CandTx[]; amount: number
  links: { invoiceId: string; transactionId: string; amount: number }[]
}

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`

// ── 지급 후보 모달 (3단계 — 후보는 시스템, 확정은 사용자) ─────────────
export function CandidateModal({ vendorId, vendorName, onClose, onApplied }: {
  vendorId: string; vendorName: string; onClose: () => void; onApplied: () => void
}) {
  const [groups, setGroups] = useState<CandGroup[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [summary, setSummary] = useState<{ unpaid_invoices: number; available_txs: number; coverable_amount: number } | null>(null)

  useEffect(() => {
    fetch(`/api/purchase-cycle/payment-candidates?vendorId=${vendorId}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setError(j.error ?? '후보 조회 실패'); return }
        setGroups(j.groups ?? [])
        setSummary(j.summary ?? null)
        setChecked(new Set((j.groups ?? []).map((_: unknown, i: number) => i)))  // 기본 전체 선택
      })
      .catch(() => setError('네트워크 오류'))
  }, [vendorId])

  const apply = async () => {
    if (!groups) return
    const links = groups.filter((_, i) => checked.has(i)).flatMap(g => g.links)
    if (!links.length) return
    if (!window.confirm(`${vendorName}: 선택한 ${checked.size}개 그룹(연결 ${links.length}건)을 확정합니다.`)) return
    setApplying(true)
    const res = await fetch('/api/purchase-cycle/apply-payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links }),
    })
    const json = await res.json()
    setApplying(false)
    if (!res.ok) { setError(json.error ?? '연결 실패'); return }
    onApplied()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">{vendorName} — 지급 연결 후보</h3>
        <p className="text-xs text-gray-500 mt-1 mb-4">
          금액이 정확히 맞는 조합만 제시합니다. 확인 후 확정하세요 (연결은 언제든 해제 가능).
          {summary && ` · 미결제 계산서 ${summary.unpaid_invoices}건 · 미연결 출금 ${summary.available_txs}건`}
        </p>
        {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
        {!groups ? (
          <p className="text-gray-400 text-sm py-8 text-center">후보 계산 중...</p>
        ) : groups.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">
            금액이 맞는 후보가 없습니다.<br />
            <span className="text-xs text-gray-400">통장 출금에 이 거래처가 연결(태깅)되어 있어야 후보에 잡힙니다.
            거래내역 화면에서 해당 출금에 거래처를 지정한 뒤 다시 시도해보세요.</span>
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {groups.map((g, i) => (
                <label key={i} className={`block border rounded-lg p-3 cursor-pointer ${checked.has(i) ? 'border-slate-800 bg-slate-50' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={checked.has(i)}
                      onChange={e => setChecked(prev => { const n = new Set(prev); if (e.target.checked) n.add(i); else n.delete(i); return n })} />
                    <span className="text-sm font-medium text-gray-900">{g.label}</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums">{won(g.amount)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
                    <div>
                      <p className="text-gray-400 mb-1">계산서</p>
                      {g.invoices.map(inv => (
                        <p key={inv.id} className="text-gray-700">{inv.issue_date.slice(0, 10)} · {(inv.item_name ?? '').slice(0, 14) || '-'} · {won(inv.remaining)}</p>
                      ))}
                    </div>
                    <div>
                      <p className="text-gray-400 mb-1">통장 출금</p>
                      {g.txs.map(tx => (
                        <p key={tx.id} className="text-gray-700">{tx.tx_date.slice(0, 10)}{tx.tx_time ? ' ' + tx.tx_time.slice(0, 5) : ''} · {(tx.description ?? '').slice(0, 14) || '-'} · {won(tx.remaining)}</p>
                      ))}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
              <button onClick={apply} disabled={applying || checked.size === 0}
                className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {applying ? '연결 중...' : `선택 ${checked.size}개 그룹 연결 확정`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
