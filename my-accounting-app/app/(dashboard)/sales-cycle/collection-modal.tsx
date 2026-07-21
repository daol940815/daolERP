'use client'

import { useEffect, useState } from 'react'

// 수금 후보 모달 (매출 사이클 — 후보는 시스템, 확정은 사용자)
// 매입 지급후보 모달과 동일한 구조: 금액이 정확히 맞는 조합만 제시한다.

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const dt = (d: string, t?: string | null) => (t ? `${d.slice(0, 10)} ${t.slice(0, 8)}` : d.slice(0, 10))

interface Group {
  type: 'exact' | 'combined_orders' | 'split_collection'
  label: string
  orders: { id: string; order_no: string; order_date: string; remaining: number }[]
  deposits: { id: string; source_type: 'bank' | 'card'; tx_date: string; tx_time?: string | null; label: string; remaining: number }[]
  amount: number
  links: { orderId: string; sourceType: 'bank' | 'card'; sourceId: string; amount: number; paidDate: string }[]
}

export default function CollectionModal({ vendorId, vendorName, onClose, onApplied }: {
  vendorId: string
  vendorName: string
  onClose: () => void
  onApplied: () => void
}) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [summary, setSummary] = useState<{ open_orders: number; available_deposits: number; coverable_amount: number } | null>(null)
  const [prepay, setPrepay] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    fetch(`/api/sales-cycle/collection-candidates?vendorId=${vendorId}`, { cache: 'no-store' })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { setError(j.error ?? '후보 조회 실패'); setGroups([]); return }
        setGroups(j.groups ?? [])
        setSummary(j.summary ?? null)
        setPrepay(!!j.prepayCustomer)
        setChecked(new Set((j.groups ?? []).map((_: unknown, i: number) => i)))
      })
      .catch(() => { setError('네트워크 오류'); setGroups([]) })
  }, [vendorId])

  const toggle = (i: number) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  const apply = async () => {
    if (!groups) return
    const targets = groups.filter((_, i) => checked.has(i))
    if (!targets.length) { setError('선택된 조합이 없습니다.'); return }
    const amount = targets.reduce((s, g) => s + g.amount, 0)
    if (!confirm(`${targets.length}개 조합(${won(amount)})을 수금 확정합니다.\n(연결은 언제든 해제할 수 있습니다)`)) return
    setApplying(true)
    setError(null)
    const res = await fetch('/api/sales-cycle/collection-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links: targets.flatMap(g => g.links) }),
    })
    const json = await res.json()
    setApplying(false)
    if (!res.ok) { setError(json.error ?? '확정 실패'); return }
    onApplied()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">{vendorName} — 수금 연결 후보</h3>
        <p className="text-xs text-gray-500 mt-1 mb-3">
          금액이 정확히 맞는 조합만 제시합니다. 확인 후 확정하세요.
          {summary && ` · 미수 주문 ${summary.open_orders}건 · 미배분 입금 ${summary.available_deposits}건`}
        </p>
        {prepay && (
          <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-3">
            선입금 관행 매출처 — 주문 전에 입금한 확정 이력이 많아, 주문 전 한 달까지의 입금도 후보에 포함합니다.
          </p>
        )}
        {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

        {!groups ? (
          <p className="text-gray-400 text-sm py-8 text-center">후보 계산 중...</p>
        ) : groups.length === 0 ? (
          <p className="text-gray-400 text-sm py-8 text-center">
            금액이 맞는 조합이 없습니다.<br />
            <span className="text-xs">부분 입금·수수료 차감 건은 ERP 매칭 화면에서 직접 배분해주세요.</span>
          </p>
        ) : (
          <div className="space-y-2.5">
            {groups.map((g, i) => (
              <label key={i} className={`block border rounded-lg p-3 cursor-pointer transition-colors ${checked.has(i) ? 'border-slate-500 bg-slate-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                  <span className="text-sm font-semibold text-gray-900">{g.label}</span>
                  <span className="ml-auto text-sm font-bold text-gray-900">{won(g.amount)}</span>
                </div>
                <div className="pl-6 text-xs text-gray-600 space-y-0.5">
                  {g.orders.map(o => (
                    <p key={o.id}>주문 {o.order_date.slice(0, 10)} · {o.order_no} · {won(o.remaining)}</p>
                  ))}
                  {g.deposits.map(d => (
                    <p key={d.id} className="text-sky-800">
                      {d.source_type === 'bank' ? '통장' : '카드'} {dt(d.tx_date, d.tx_time)} · {d.label} · {won(d.remaining)}
                    </p>
                  ))}
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={apply} disabled={applying || !groups?.length}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {applying ? '확정 중...' : `선택 ${checked.size}개 조합 확정`}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">닫기</button>
          <span className="text-xs text-gray-400">확정 시 ERP 수금 대사에 기록되며 언제든 해제할 수 있습니다.</span>
        </div>
      </div>
    </div>
  )
}
