'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import PurchaseSection from './purchase-section'

// 주문 상세 (2단계) — 업로드·직접입력 공통 조회.
// direct 주문 (2026-08-25 취소·재등록 확정): 당일(본인)·관리자는 직접 수정(변경 로그),
// 익일 이후는 취소·재등록. 삭제는 취소 처리로 통일 — 승인 절차 없음, 이력 보존.

interface Item {
  id: string; line_no: number; is_canceled: boolean; is_prepayment: boolean
  parent_line_no: number | null
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
interface EditLog {
  id: string; employee_name: string | null; field_label: string
  before_text: string | null; after_text: string | null; created_at: string
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
  const [order, setOrder] = useState<Record<string, unknown> | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [editLogs, setEditLogs] = useState<EditLog[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [canReissue, setCanReissue] = useState(false)
  const [canceled, setCanceled] = useState(false)
  const [reissuedToNo, setReissuedToNo] = useState<string | null>(null)
  const [reissuedFromNo, setReissuedFromNo] = useState<string | null>(null)
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
      setEditLogs(json.edit_logs ?? [])
      setCanEdit(json.can_edit)
      setCanReissue(json.can_reissue ?? false)
      setCanceled(json.canceled ?? false)
      setReissuedToNo(json.reissued_to_no ?? null)
      setReissuedFromNo(json.reissued_from_no ?? null)
    }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  // 주문 취소 (삭제 대체) — 물리 삭제 없이 취소 처리, 집계에서 제외 (상계)
  const cancelOrder = async () => {
    const res = await fetch(
      `/api/orders-portal/orders/${id}?reason=${encodeURIComponent(cancelReason.trim())}`,
      { method: 'DELETE' },
    )
    const json = await res.json()
    if (!res.ok) { setError(json.error); return }
    setAskingCancel(false); setCancelReason('')
    load()
  }

  if (loading) return <div className="text-center py-16 text-gray-400">로딩 중...</div>
  if (error && !order) return <div className="px-4 py-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
  if (!order) return null

  const isDirect = order.source === 'direct'
  const showCost = true   // 매입가·마진 전 직원 공개 (2026-08-13 사용자 결정)
  const activeItems = items.filter(it => !it.is_canceled)
  const cost = activeItems.reduce((s, it) => s + (it.purchase_total ?? 0), 0)
  const total = order.total_amount as number

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/orders" className="text-sm text-gray-400 hover:text-gray-600">← 주문 현황</Link>
        <h1 className="text-xl font-bold text-gray-900">주문 상세</h1>
        <span className="text-sm text-gray-400 tabular-nums">{String(order.order_no ?? '')}</span>
        <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${isDirect ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
          {isDirect ? '직접입력' : '업로드'}
        </span>
        {canceled && (
          <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">취소됨</span>
        )}
        <span className="ml-auto flex gap-2">
          {/* 거래명세서 — 판매가(할인 반영) 기준, 실무자 양식 그대로 출력 */}
          <a href={`/api/orders-portal/orders/${id}/statement`}
            className="px-3.5 py-1.5 border border-emerald-300 text-emerald-700 rounded-lg text-sm hover:bg-emerald-50">
            거래명세서
          </a>
          {isDirect && canEdit && (
            <Link href={`/orders/${id}/edit`}
              className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">수정</Link>
          )}
          {isDirect && !canEdit && canReissue && (
            <Link href={`/orders/new?reissue=${id}`}
              className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm"
              title="원본을 취소 처리하고 내용을 프리필해 새 주문으로 등록합니다">취소·재등록</Link>
          )}
          {isDirect && canReissue && (
            <button onClick={() => setAskingCancel(v => !v)}
              className="px-3.5 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm">주문 취소</button>
          )}
        </span>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 취소·재등록 링크 안내 */}
      {canceled && (
        <div className="mt-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          취소된 주문입니다 — 매출·미수 집계에서 제외됩니다.
          {typeof order.cancel_reason === 'string' && order.cancel_reason && (
            <span className="text-red-500"> (사유: {order.cancel_reason})</span>
          )}
          {reissuedToNo && <span className="ml-2">재등록 주문: <b className="tabular-nums">{reissuedToNo}</b></span>}
        </div>
      )}
      {reissuedFromNo && !canceled && (
        <div className="mt-3 px-4 py-2.5 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
          취소·재등록으로 만들어진 주문입니다 — 원본: <b className="tabular-nums">{reissuedFromNo}</b> (취소 처리됨)
        </div>
      )}

      {askingCancel && (
        <div className="mt-3 p-3 bg-red-50/60 border border-red-200 rounded-lg flex items-center gap-2 flex-wrap">
          <input value={cancelReason} onChange={e => setCancelReason(e.target.value)}
            placeholder="취소 사유 (선택)"
            className="flex-1 min-w-64 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={cancelOrder} className="px-3.5 py-1.5 bg-red-600 text-white rounded-lg text-sm">주문 취소 확정</button>
          <span className="text-[11px] text-gray-500">
            삭제 대신 취소로 처리됩니다 — 원본은 보존되고 집계에서만 빠집니다 (되돌리려면 재등록)
          </span>
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
            // 소개자·책임자는 direct 입력에서 제거된 항목 — 값이 있는 기존 업로드 주문만 표시
            ...(order.introducer ? [['소개자', String(order.introducer)]] : []),
            ...(order.supervisor || order.supervisor_contact
              ? [['책임자', [order.supervisor, order.supervisor_contact].filter(Boolean).join(' / ')]] : []),
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
              {showCost && <th className="py-2 px-2.5 text-right font-medium">매입가</th>}
              {showCost && <th className="py-2 px-2.5 text-right font-medium">매입합계</th>}
              <th className="py-2 px-2.5 text-left font-medium">상담자</th>
              <th className="py-2 px-2.5 text-left font-medium">메모</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className={`border-b border-gray-50 ${it.is_canceled ? 'text-gray-300 line-through' : ''}`}>
                <td className="py-1.5 px-2.5 tabular-nums">{it.line_no}</td>
                <td className="py-1.5 px-2.5">{it.item_code ?? '-'}</td>
                <td className={`py-1.5 px-2.5 font-medium ${it.parent_line_no ? 'pl-6' : ''}`}>
                  {it.parent_line_no && <span className="text-gray-400 mr-1 font-normal" title={`${it.parent_line_no}번 행의 옵션`}>└</span>}
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
                {showCost && <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.purchase_price)}</td>}
                {showCost && <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.purchase_total)}</td>}
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
          {showCost && <span className="text-gray-500">매입 합계 <span className="tabular-nums">{won(cost)}원</span></span>}
          {showCost && <span className="text-emerald-700">예상 마진 <b className="tabular-nums">{won(total - cost)}원</b></span>}
        </div>
      </div>

      {/* 발주 (3단계) — direct 주문만. 업로드 주문은 기존 ERP에서 발주 완료된 건.
          취소 주문은 새 발주를 막기 위해 숨긴다 (기존 발주서는 발주서 이력에서 확인) */}
      {isDirect && showCost && !canceled && <PurchaseSection orderId={String(id)} />}

      {/* 변경 이력 (511) — 접이식: 누가·언제·무엇을 어떻게 바꿨는지 */}
      {editLogs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
          <button onClick={() => setShowLogs(v => !v)}
            className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            변경 이력 <span className="text-[11px] font-normal text-gray-400">{editLogs.length}건</span>
            <span className="text-gray-400 text-xs">{showLogs ? '▾' : '▸'}</span>
          </button>
          {showLogs && (
            <table className="w-full text-xs mt-2.5">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">일시</th>
                  <th className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">직원</th>
                  <th className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">항목</th>
                  <th className="py-1.5 text-left font-medium">변경 내용</th>
                </tr>
              </thead>
              <tbody>
                {editLogs.map(l => (
                  <tr key={l.id} className="border-b border-gray-50 align-top">
                    <td className="py-1.5 pr-3 tabular-nums text-gray-400 whitespace-nowrap">
                      {l.created_at.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{l.employee_name ?? '-'}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap font-medium text-gray-700">{l.field_label}</td>
                    <td className="py-1.5 text-gray-600">
                      {l.before_text && l.after_text
                        ? <>{l.before_text} <span className="text-gray-300">→</span> {l.after_text}</>
                        : l.after_text ?? l.before_text ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 수정 요청 이력 */}
      {requests.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
          <div className="text-sm font-bold text-gray-900 mb-2">
            수정·취소 요청 이력 <span className="text-[11px] font-normal text-gray-400">과거 승인 제도 기록 — 현재는 취소·재등록 방식</span>
          </div>
          <div className="space-y-1.5">
            {requests.map(r => {
              const s = REQ_STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-500' }
              return (
                <div key={r.id} className="flex items-center gap-2.5 text-sm flex-wrap">
                  <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${s.cls}`}>{s.label}</span>
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
