'use client'

import { useEffect, useMemo, useState } from 'react'

// 취소발행 상계 확인 모달 — 원 계산서(+A)와 취소 계산서(-A) 쌍을 보여주고
// 사용자가 선택한 쌍만 '확인됨'으로 상계 처리한다. (추천만 — 확정은 사용자)

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

interface Pair {
  pos_id: string
  neg_id: string
  counterparty: string
  pos_date: string
  neg_date: string
  amount: number
  tax_type: string
  item_name: string | null
  gap_days: number
}

export default function CancelPairsModal({ direction, onClose, onApplied }: {
  direction: string
  onClose: () => void
  onApplied: (confirmed: number) => void
}) {
  const [pairs, setPairs] = useState<Pair[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = (p: Pair) => `${p.pos_id}:${p.neg_id}`

  useEffect(() => {
    fetch(`/api/tax-invoices/cancel-pairs?direction=${direction}`)
      .then(r => r.json())
      .then(j => {
        if (Array.isArray(j.pairs)) {
          setPairs(j.pairs)
          setChecked(new Set(j.pairs.map((p: Pair) => `${p.pos_id}:${p.neg_id}`)))
        } else setError(j.error ?? '조회 실패')
      })
      .catch(() => setError('조회 실패'))
  }, [direction])

  const allChecked = !!pairs && pairs.length > 0 && checked.size === pairs.length
  const selectedAmount = useMemo(
    () => (pairs ?? []).filter(p => checked.has(key(p))).reduce((s, p) => s + p.amount, 0),
    [pairs, checked]
  )

  const toggle = (p: Pair) => {
    setChecked(prev => {
      const next = new Set(prev)
      const k = key(p)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const apply = async () => {
    if (!pairs || busy) return
    const targets = pairs.filter(p => checked.has(key(p)))
    if (!targets.length) return
    setBusy(true)
    const res = await fetch('/api/tax-invoices/cancel-pairs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, pairs: targets.map(p => ({ posId: p.pos_id, negId: p.neg_id })) }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '처리 실패'); return }
    onApplied(json.confirmed ?? 0)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">취소발행 상계 확인</h2>
          <p className="text-xs text-gray-500 mt-1">
            같은 거래처의 원 계산서와 취소(음수) 계산서가 합계 0으로 남은 쌍입니다.
            확인하면 두 건 모두 거래 연결 없이 확인됨으로 처리됩니다. (부분취소·재발행 건은 목록에서 함께 선택해 합산 매칭을 사용하세요)
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error ? (
            <p className="text-sm text-red-600 py-8 text-center">{error}</p>
          ) : pairs === null ? (
            <p className="text-sm text-gray-400 py-8 text-center">탐색 중...</p>
          ) : pairs.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">상계할 취소쌍이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 border-b border-gray-200">
                <tr>
                  <th className="py-2 px-2 w-8 text-left">
                    <input type="checkbox" checked={allChecked}
                      onChange={() => setChecked(allChecked ? new Set() : new Set(pairs.map(p => key(p))))} />
                  </th>
                  <th className="py-2 px-2 text-left">거래처</th>
                  <th className="py-2 px-2 text-left">원 계산서</th>
                  <th className="py-2 px-2 text-left">취소 계산서</th>
                  <th className="py-2 px-2 text-right">금액</th>
                  <th className="py-2 px-2 text-right">간격</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pairs.map(p => (
                  <tr key={key(p)} className={checked.has(key(p)) ? 'bg-amber-50/60' : ''}>
                    <td className="py-2 px-2">
                      <input type="checkbox" checked={checked.has(key(p))} onChange={() => toggle(p)} />
                    </td>
                    <td className="py-2 px-2">
                      <p className="text-gray-900 truncate max-w-[180px]">{p.counterparty}</p>
                      {p.item_name && <p className="text-xs text-gray-400 truncate max-w-[180px]">{p.item_name}</p>}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-gray-600">{p.pos_date}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-red-600">{p.neg_date}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums">{won(p.amount)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap text-xs text-gray-400">{p.gap_days}일</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-3">
          {pairs && pairs.length > 0 && (
            <p className="text-sm text-gray-600">
              <b>{checked.size}</b>쌍 선택 · 상계 금액 {won(selectedAmount)}
            </p>
          )}
          <button onClick={onClose} className="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            닫기
          </button>
          <button onClick={apply} disabled={busy || !pairs || checked.size === 0}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40">
            {busy ? '처리 중...' : `선택 ${checked.size}쌍 상계 확인`}
          </button>
        </div>
      </div>
    </div>
  )
}
