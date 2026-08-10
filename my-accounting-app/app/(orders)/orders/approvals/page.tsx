'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

// 주문 수정·취소 승인 (manager/admin)
// 익일 이후 sales의 수정 경로 — 음수 상계 주문 방식의 대체.
// sales 본인은 자기 요청의 진행 상태만 보인다 (API에서 분리).

interface SnapshotItem {
  item_name: string | null; quantity: number; sale_price: number; line_total: number
  is_canceled?: boolean
}
interface PayloadItem {
  item_name: string; quantity: number; sale_price: number
  shipping_fee?: number; discount_amount?: number
}
interface Req {
  id: string; order_id: string; request_type: 'edit' | 'cancel'; reason: string
  status: string; decision_memo: string | null; created_at: string; decided_at: string | null
  payload: { order_date?: string; memo?: string | null; items?: PayloadItem[] } | null
  before_snapshot: { order: Record<string, unknown>; items: SnapshotItem[] }
  requester: { id: string; name: string } | null
  decider: { id: string; name: string } | null
  order: { id: string; order_no: string; order_date: string; bank_name: string | null; branch_name: string | null; total_amount: number } | null
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const lineOf = (it: PayloadItem) =>
  it.sale_price * it.quantity + (it.shipping_fee ?? 0) - (it.discount_amount ?? 0)

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: '대기', cls: 'bg-amber-100 text-amber-800' },
  approved:  { label: '승인', cls: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: '반려', cls: 'bg-red-100 text-red-700' },
  withdrawn: { label: '철회', cls: 'bg-gray-100 text-gray-500' },
}

export default function ApprovalsPage() {
  const [requests, setRequests] = useState<Req[]>([])
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [memos, setMemos] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const res = await fetch(`/api/orders-portal/change-requests?status=${tab === 'all' ? 'all' : 'pending'}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else setRequests(json.requests)
    setLoading(false)
  }, [tab])
  useEffect(() => { load() }, [load])

  const decide = async (id: string, action: 'approve' | 'reject') => {
    if (action === 'reject' && !(memos[id] ?? '').trim()) {
      setError('반려 사유를 입력해주세요.'); return
    }
    if (action === 'approve' && !confirm('요청 내용을 주문에 반영합니다. 승인할까요?')) return
    setBusy(id); setError(null)
    const res = await fetch(`/api/orders-portal/change-requests/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, memo: memos[id] ?? '' }),
    })
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '처리 실패')
    else await load()
    setBusy(null)
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">주문 수정 승인</h1>
        <span className="text-xs text-gray-400">익일 이후 주문의 수정·취소 요청 — 승인 시 주문에 반영</span>
        <span className="ml-auto flex gap-1.5">
          {(['pending', 'all'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-xs border ${tab === t ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-500'}`}>
              {t === 'pending' ? '대기 중' : '전체 이력'}
            </button>
          ))}
        </span>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="mt-4 space-y-3">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : requests.map(r => {
          const badge = STATUS_BADGE[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-500' }
          const customer = [r.order?.bank_name, r.order?.branch_name].filter(Boolean).join(' ') || '(주문처 미상)'
          const beforeItems = (r.before_snapshot?.items ?? []).filter(it => !it.is_canceled)
          const afterItems = r.payload?.items ?? []
          const beforeTotal = Number(r.before_snapshot?.order?.total_amount ?? 0)
          const afterTotal = afterItems.reduce((s, it) => s + lineOf(it), 0)
          return (
            <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2.5 flex-wrap text-sm">
                <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${r.request_type === 'cancel' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'}`}>
                  {r.request_type === 'cancel' ? '취소 요청' : '수정 요청'}
                </span>
                <Link href={`/orders/${r.order_id}`} className="font-semibold hover:underline">
                  {customer}
                </Link>
                <span className="text-xs text-gray-400 tabular-nums">
                  {r.order?.order_no} · 주문일 {r.order?.order_date}
                </span>
                <span className="text-xs text-gray-400 ml-auto tabular-nums">
                  {r.requester?.name ?? '?'} 요청 · {r.created_at.slice(0, 16).replace('T', ' ')}
                </span>
              </div>

              <div className="mt-2 text-sm text-gray-700">
                사유: <span className="font-medium">{r.reason}</span>
              </div>

              {r.request_type === 'edit' && (
                <div className="mt-2.5 grid md:grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <div className="text-[11px] text-gray-400 mb-1">현재 (변경 전) — 총 {won(beforeTotal)}원</div>
                    {beforeItems.map((it, i) => (
                      <div key={i} className="flex justify-between py-0.5">
                        <span>{it.item_name} × {it.quantity}</span>
                        <span className="tabular-nums">{won(it.line_total)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-blue-50/50 rounded-lg p-2.5 border border-blue-100">
                    <div className="text-[11px] text-blue-600 mb-1">
                      제안 (변경 후) — 총 {won(afterTotal)}원
                      {afterTotal !== beforeTotal && (
                        <span className={`ml-1.5 font-semibold ${afterTotal > beforeTotal ? 'text-emerald-600' : 'text-red-500'}`}>
                          ({afterTotal > beforeTotal ? '+' : ''}{won(afterTotal - beforeTotal)})
                        </span>
                      )}
                    </div>
                    {afterItems.map((it, i) => (
                      <div key={i} className="flex justify-between py-0.5">
                        <span>{it.item_name} × {it.quantity}</span>
                        <span className="tabular-nums">{won(lineOf(it))}</span>
                      </div>
                    ))}
                    {r.payload?.order_date && r.payload.order_date !== r.order?.order_date && (
                      <div className="mt-1 text-[11px] text-blue-700">주문일 변경: {r.order?.order_date} → {r.payload.order_date}</div>
                    )}
                  </div>
                </div>
              )}
              {r.request_type === 'cancel' && (
                <div className="mt-2 text-xs text-red-600 bg-red-50/60 rounded-lg px-3 py-2">
                  승인 시 전체 품목이 취소 처리되고 주문 금액·미수금이 0원이 됩니다. (행은 이력으로 보존)
                </div>
              )}

              {r.status === 'pending' ? (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <input value={memos[r.id] ?? ''} onChange={e => setMemos(m => ({ ...m, [r.id]: e.target.value }))}
                    placeholder="처리 메모 (반려 시 필수)"
                    className="flex-1 min-w-56 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                  <button disabled={busy === r.id} onClick={() => decide(r.id, 'approve')}
                    className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">승인·반영</button>
                  <button disabled={busy === r.id} onClick={() => decide(r.id, 'reject')}
                    className="px-4 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm disabled:opacity-50">반려</button>
                </div>
              ) : (
                <div className="mt-2 text-xs text-gray-400">
                  {r.decider?.name && `${r.decider.name} 처리`}
                  {r.decided_at && ` · ${r.decided_at.slice(0, 16).replace('T', ' ')}`}
                  {r.decision_memo && ` · ${r.decision_memo}`}
                </div>
              )}
            </div>
          )
        })}
        {!loading && !requests.length && (
          <div className="text-center py-16 text-gray-400 text-sm bg-white border border-gray-200 rounded-xl">
            {tab === 'pending' ? '대기 중인 요청이 없습니다.' : '요청 이력이 없습니다.'}
          </div>
        )}
      </div>
    </div>
  )
}
