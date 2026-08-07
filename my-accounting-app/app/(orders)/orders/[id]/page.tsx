'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

// 주문 상세 (2단계) — 업로드·직접입력 공통 조회.
// direct 주문: 당일(본인)·관리자는 수정/삭제, 익일 이후 본인은 수정요청·취소요청.

interface Item {
  id: string; line_no: number; is_canceled: boolean; is_prepayment: boolean
  item_code: string | null; item_name: string | null; order_kind: string | null
  purchase_vendor_name: string | null; sale_price: number; quantity: number
  shipping_fee: number; discount_amount: number; line_total: number
  purchase_price: number; purchase_shipping: number; purchase_total: number
  channel: string | null; memo: string | null
}
interface ChangeRequest {
  id: string; request_type: string; reason: string; status: string
  decision_memo: string | null; created_at: string; decided_at: string | null
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const STATUS_KO: Record<string, string> = {
  collected: '수금완료', outstanding: '미수금', in_progress: '수금진행중',
}
const REQ_STATUS: Record<string, { label: string; cls: string }> = {
  pending:   { label: '승인 대기', cls: 'bg-amber-100 text-amber-800' },
  approved:  { label: '승인됨',   cls: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: '반려됨',   cls: 'bg-red-100 text-red-700' },
  withdrawn: { label: '철회됨',   cls: 'bg-gray-100 text-gray-500' },
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<Record<string, unknown> | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [needsRequest, setNeedsRequest] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelReason, setCancelReason] = useState('')
  const [askingCancel, setAskingCancel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/orders-portal/orders/${id}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else {
      setOrder(json.order); setItems(json.items)
      setRequests(json.change_requests ?? [])
      setCanEdit(json.can_edit); setNeedsRequest(json.needs_request)
    }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const removeOrder = async () => {
    if (!confirm('이 주문을 삭제할까요? (당일 입력분만 가능)')) return
    const res = await fetch(`/api/orders-portal/orders/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) { setError(json.error); return }
    router.push('/orders')
  }

  const requestCancel = async () => {
    if (!cancelReason.trim()) { setError('취소 사유를 입력해주세요.'); return }
    const res = await fetch('/api/orders-portal/change-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, request_type: 'cancel', reason: cancelReason }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); return }
    setAskingCancel(false); setCancelReason('')
    load()
  }

  if (loading) return <div className="text-center py-16 text-gray-400">로딩 중...</div>
  if (error && !order) return <div className="px-4 py-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
  if (!order) return null

  const isDirect = order.source === 'direct'
  const activeItems = items.filter(it => !it.is_canceled)
  const cost = activeItems.reduce((s, it) => s + (it.purchase_total ?? 0), 0)
  const total = order.total_amount as number

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/orders" className="text-sm text-gray-400 hover:text-gray-600">← 주문 현황</Link>
        <h1 className="text-xl font-bold text-gray-900">주문 상세</h1>
        <span className="text-sm text-gray-400 tabular-nums">{String(order.order_no ?? '')}</span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${isDirect ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
          {isDirect ? '직접입력' : '업로드'}
        </span>
        <span className="ml-auto flex gap-2">
          {isDirect && canEdit && (
            <>
              <Link href={`/orders/${id}/edit`}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">수정</Link>
              <button onClick={removeOrder}
                className="px-3.5 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm">삭제</button>
            </>
          )}
          {isDirect && !canEdit && needsRequest && (
            <>
              <Link href={`/orders/${id}/edit`}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">수정 요청</Link>
              <button onClick={() => setAskingCancel(v => !v)}
                className="px-3.5 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm">취소 요청</button>
            </>
          )}
        </span>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {askingCancel && (
        <div className="mt-3 p-3 bg-red-50/60 border border-red-200 rounded-lg flex items-center gap-2 flex-wrap">
          <input value={cancelReason} onChange={e => setCancelReason(e.target.value)}
            placeholder="취소 사유 (필수)"
            className="flex-1 min-w-64 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={requestCancel} className="px-3.5 py-1.5 bg-red-600 text-white rounded-lg text-sm">취소 요청 제출</button>
          <span className="text-[11px] text-gray-500">관리자 승인 시 전체 품목이 취소 처리됩니다</span>
        </div>
      )}

      {/* 주문 정보 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
          {[
            ['주문일', String(order.order_date ?? '-')],
            ['주문처', [order.bank_name, order.branch_name].filter(Boolean).join(' ') || '-'],
            ['담당자(거래처)', String(order.manager_name ?? '-')],
            ['다올직원', String(order.staff_name ?? '-')],
            ['연락처', String(order.contact ?? '-')],
            ['핸드폰', String(order.phone ?? '-')],
            ['소개자', String(order.introducer ?? '-')],
            ['책임자', [order.supervisor, order.supervisor_contact].filter(Boolean).join(' / ') || '-'],
            ['수금 상태', STATUS_KO[String(order.collect_status)] ?? String(order.collect_status ?? '-')],
            ['총금액', `${won(total)}원`],
            ['미수금', `${won(order.outstanding_amount as number)}원`],
            ['메모', String(order.memo ?? '-')],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[11px] text-gray-400">{k}</div>
              <div className="text-gray-800">{v}</div>
            </div>
          ))}
        </div>
        {typeof order.etc === 'string' && order.etc && (
          <div className="mt-2 text-xs text-red-600">{order.etc}</div>
        )}
      </div>

      {/* 품목 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th className="py-2 px-2.5 text-left font-medium">#</th>
              <th className="py-2 px-2.5 text-left font-medium">품번</th>
              <th className="py-2 px-2.5 text-left font-medium">품명</th>
              <th className="py-2 px-2.5 text-left font-medium">구분</th>
              <th className="py-2 px-2.5 text-left font-medium">매입처</th>
              <th className="py-2 px-2.5 text-right font-medium">판매가</th>
              <th className="py-2 px-2.5 text-right font-medium">갯수</th>
              <th className="py-2 px-2.5 text-right font-medium">배송비</th>
              <th className="py-2 px-2.5 text-right font-medium">할인</th>
              <th className="py-2 px-2.5 text-right font-medium">합계</th>
              <th className="py-2 px-2.5 text-right font-medium">매입가</th>
              <th className="py-2 px-2.5 text-right font-medium">매입합계</th>
              <th className="py-2 px-2.5 text-left font-medium">상담자</th>
              <th className="py-2 px-2.5 text-left font-medium">메모</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className={`border-b border-gray-50 ${it.is_canceled ? 'text-gray-300 line-through' : ''}`}>
                <td className="py-1.5 px-2.5 tabular-nums">{it.line_no}</td>
                <td className="py-1.5 px-2.5">{it.item_code ?? '-'}</td>
                <td className="py-1.5 px-2.5 font-medium">
                  {it.item_name}
                  {it.is_canceled && <span className="ml-1.5 no-underline text-[10px] text-red-400">취소</span>}
                  {it.is_prepayment && <span className="ml-1.5 text-[10px] text-violet-500">선결제</span>}
                </td>
                <td className="py-1.5 px-2.5">{it.order_kind ?? '-'}</td>
                <td className="py-1.5 px-2.5">{it.purchase_vendor_name ?? '-'}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.sale_price)}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{it.quantity}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.shipping_fee)}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.discount_amount)}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold">{won(it.line_total)}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.purchase_price)}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.purchase_total)}</td>
                <td className="py-1.5 px-2.5 whitespace-nowrap">{it.channel ?? '-'}</td>
                <td className="py-1.5 px-2.5">
                  <div className="max-w-[11rem] truncate" title={it.memo ?? undefined}>{it.memo ?? '-'}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-6 px-4 py-2.5 text-sm border-t border-gray-100">
          <span>총금액 <b className="tabular-nums">{won(total)}원</b></span>
          <span className="text-gray-500">매입 합계 <span className="tabular-nums">{won(cost)}원</span></span>
          <span className="text-emerald-700">예상 마진 <b className="tabular-nums">{won(total - cost)}원</b></span>
        </div>
      </div>

      {/* 수정 요청 이력 */}
      {requests.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
          <div className="text-sm font-bold text-gray-900 mb-2">수정·취소 요청 이력</div>
          <div className="space-y-1.5">
            {requests.map(r => {
              const s = REQ_STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-500' }
              return (
                <div key={r.id} className="flex items-center gap-2.5 text-sm flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${s.cls}`}>{s.label}</span>
                  <span className="text-[11px] text-gray-400">{r.request_type === 'cancel' ? '취소' : '수정'}</span>
                  <span className="text-gray-700">{r.reason}</span>
                  {r.decision_memo && <span className="text-xs text-gray-400">→ {r.decision_memo}</span>}
                  <span className="text-[11px] text-gray-300 tabular-nums ml-auto">{r.created_at.slice(0, 10)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
