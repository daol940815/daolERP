'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import PurchaseSection from './purchase-section'
import { hasShip, needsShip, shipText, SHIP_KINDS } from '@/lib/ship-address'
import RosterCard from '../roster-card'
import ReplyCard, { type ReplyData } from './reply-card'
import PayRecords, { type PayRecordsData } from './pay-records'
import { PAY_METHOD_TAG_LABEL, PAY_STAGE_LABEL, showMethodTag, type PayState } from '@/lib/pay-state'
import ReasonPicker from '@/components/ui/ReasonPicker'
import { ORDER_CANCEL_REASONS, composeReason } from '@/lib/cancel-reasons'
import { ORDERS_LIST_URL_KEY } from '@/lib/order-search-fields'

// 주문 상세 (2단계) — 업로드·직접입력 공통 조회.
// direct 주문 (2026-08-25 취소·재등록 확정): 당일(본인)·관리자는 직접 수정(변경 로그),
// 익일 이후는 취소·재등록. 삭제는 취소 처리로 통일 — 승인 절차 없음, 이력 보존.

interface Item {
  id: string; line_no: number; is_canceled: boolean; is_prepayment: boolean; is_vip?: boolean
  parent_line_no: number | null
  item_code: string | null; item_name: string | null; order_kind: string | null
  purchase_vendor_name: string | null; sale_price: number; quantity: number
  shipping_fee: number; discount_amount: number; discount_mode?: string | null; discount_unit?: number | null; line_total: number
  purchase_price: number; purchase_shipping: number; purchase_total: number
  purchase_discount?: number | null; purchase_discount_mode?: string | null; purchase_discount_unit?: number | null   // 708
  order_season?: string | null                                                                                     // 708 주문시기
  channel: string | null; memo: string | null
  is_cost?: boolean   // 비용 품목 (품목 마스터 체크) — 배송지 판정 제외
}
interface ChangeRequest {
  id: string; request_type: string; reason: string; status: string
  decision_memo: string | null; created_at: string; decided_at: string | null
}
interface EditLog {
  id: string; employee_name: string | null; field_label: string
  before_text: string | null; after_text: string | null; created_at: string
}
// 결제 내역 (2026-11-04 — 표기 전용, 회계 화면 링크 없음)
interface PaymentMatch {
  id: string; source_type: 'bank' | 'card' | 'cash' | 'prepay'; amount: number; paid_date: string; record_id?: string | null
  matched_by: string; memo: string | null
  source: { label: string; total: number } | null
}
interface PaymentInvoice {
  id: string; amount: number; issue_date: string
  invoice_total: number | null; paid_sum: number; paid_last_date: string | null
}
interface Payments { matches: PaymentMatch[]; invoices: PaymentInvoice[] }
// 선결제 사용 (514, 2026-11-05) — 주문처 잔액 · 사용 가능 여부
interface PrepayInfo { balance: number; deposit: number; deduction: number; can_use: boolean }
// 표준 미수(회계 트랙 v_erp_order_receivable — 수금 매칭 반영). 뷰 미적용이면 null → 원본값 폴백
interface Receivable { net_sales: number; collected: number; outstanding: number; collect_status: string }

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
  // '← 주문내역' = 마지막으로 보던 목록 주소(필터 · 페이지 포함, 2026-11-11). 없으면 /orders
  const [listHref, setListHref] = useState('/orders')
  useEffect(() => {
    try { const u = sessionStorage.getItem(ORDERS_LIST_URL_KEY); if (u && u.startsWith('/orders')) setListHref(u) } catch { /* 무시 */ }
  }, [])
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<Record<string, unknown> | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [editLogs, setEditLogs] = useState<EditLog[]>([])
  const [payments, setPayments] = useState<Payments>({ matches: [], invoices: [] })
  const [receivable, setReceivable] = useState<Receivable | null>(null)
  const [prepay, setPrepay] = useState<PrepayInfo | null>(null)
  const [payState, setPayState] = useState<PayState | null>(null)   // 목록과 같은 결제 상태 표기
  const [payRecords, setPayRecords] = useState<PayRecordsData>({ available: false, records: [], can_record: false })   // 결제 기록 (1300)
  const [consultRequest, setConsultRequest] = useState<{ requested_by_name: string | null; assignee_name: string | null } | null>(null)
  const [reply, setReply] = useState<ReplyData | null>(null)   // 완료 회신 (515)
  const [prepayOpen, setPrepayOpen] = useState(false)
  const [prepayAmt, setPrepayAmt] = useState('')
  const [prepayMemo, setPrepayMemo] = useState('')
  const [prepayBusy, setPrepayBusy] = useState(false)
  const [prepayErr, setPrepayErr] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [canReissue, setCanReissue] = useState(false)
  const [canceled, setCanceled] = useState(false)
  const [reissuedToNo, setReissuedToNo] = useState<string | null>(null)
  const [reissuedFromNo, setReissuedFromNo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelPick, setCancelPick] = useState<string | null>(null)
  const [askingCancel, setAskingCancel] = useState(false)
  const [canceledByName, setCanceledByName] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/orders-portal/orders/${id}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else {
      setOrder(json.order); setItems(json.items)
      setPayments(json.payments ?? { matches: [], invoices: [] })
      setReceivable(json.receivable ?? null)
      setPrepay(json.prepay ?? null)
      setPayState(json.pay_state ?? null)
      setPayRecords(json.pay_records ?? { available: false, records: [], can_record: false })
      setConsultRequest(json.consult_request ?? null)
      setReply(json.reply ?? null)
      setRequests(json.change_requests ?? [])
      setEditLogs(json.edit_logs ?? [])
      setCanEdit(json.can_edit)
      setCanReissue(json.can_reissue ?? false)
      setCanceled(json.canceled ?? false)
      setCanceledByName(json.canceled_by_name ?? null)
      setReissuedToNo(json.reissued_to_no ?? null)
      setReissuedFromNo(json.reissued_from_no ?? null)
    }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  // 선결제 사용 / 해제 (514) — 원장 차감 + 수금 매칭, 해제는 둘 다 삭제
  const submitPrepay = async () => {
    setPrepayBusy(true); setPrepayErr(null)
    const res = await fetch(`/api/orders-portal/orders/${id}/prepay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: prepayAmt.replace(/,/g, ''), memo: prepayMemo.trim() || null }),
    })
    const json = await res.json().catch(() => ({}))
    setPrepayBusy(false)
    if (!res.ok) { setPrepayErr(json.error ?? '선결제 사용 실패'); return }
    setPrepayOpen(false); setPrepayAmt(''); setPrepayMemo('')
    load()
  }
  const releasePrepay = async (matchId: string, amount: number) => {
    if (!window.confirm(`선결제 사용 ${won(amount)}원을 해제할까요? 선결제 잔액으로 되돌아갑니다.`)) return
    const res = await fetch(`/api/orders-portal/orders/${id}/prepay?match_id=${matchId}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { window.alert(json.error ?? '해제 실패'); return }
    load()
  }

  // 주문 취소 (삭제 대체) — 물리 삭제 없이 취소 처리, 집계에서 제외 (상계)
  //  사유 필수 (2026-11-10) — 빠른 선택 또는 직접 입력, '기타'는 직접 입력 필수
  const cancelText = composeReason(cancelPick, cancelReason)
  const cancelOrder = async () => {
    if (!cancelText) return
    const res = await fetch(
      `/api/orders-portal/orders/${id}?reason=${encodeURIComponent(cancelText)}`,
      { method: 'DELETE' },
    )
    const json = await res.json()
    if (!res.ok) { setError(json.error); return }
    setAskingCancel(false); setCancelReason(''); setCancelPick(null)
    load()
  }

  if (loading) return <div className="text-center py-16 text-gray-400">로딩 중...</div>
  if (error && !order) return <div className="px-4 py-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
  if (!order) return null

  const isDirect = order.source === 'direct'
  const showCost = true   // 매입가·마진 전 직원 공개 (2026-08-13 사용자 결정)
  const activeItems = items.filter(it => !it.is_canceled)
  const cost = activeItems.reduce((s, it) => s + (it.purchase_total ?? 0), 0)
  const costShipping = activeItems.reduce((s, it) => s + (it.purchase_shipping ?? 0), 0)   // 매입합계에 포함된 매입배송비
  const costDiscount = activeItems.reduce((s, it) => s + (it.purchase_discount ?? 0), 0)   // 매입합계에서 뺀 매입할인 (708)
  const total = order.total_amount as number
  const outstanding = receivable ? receivable.outstanding : Number(order.outstanding_amount ?? 0)
  const collectStatus = receivable ? receivable.collect_status : String(order.collect_status ?? '')
  const salesBase = receivable ? receivable.net_sales : total
  const collectedAmt = receivable ? receivable.collected : Math.max(0, total - outstanding)

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={listHref} className="text-sm text-gray-400 hover:text-gray-600">← 주문내역</Link>
        <h1 className="text-xl font-bold text-gray-900">주문 상세</h1>
        <span className="text-sm text-gray-400 tabular-nums">{String(order.order_no ?? '')}</span>
        <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${isDirect ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
          {isDirect ? '직접입력' : '업로드'}
        </span>
        {canceled && (
          <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium bg-red-100 text-red-700">취소됨</span>
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
          {typeof order.canceled_at === 'string' && (
            <div className="text-xs text-red-500 mt-0.5 tabular-nums">
              {[canceledByName, new Date(order.canceled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })].filter(Boolean).join(' · ')} 취소
            </div>
          )}
        </div>
      )}
      {reissuedFromNo && !canceled && (
        <div className="mt-3 px-4 py-2.5 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
          취소·재등록으로 만들어진 주문입니다 — 원본: <b className="tabular-nums">{reissuedFromNo}</b> (취소 처리됨)
        </div>
      )}

      {askingCancel && (
        <div className="mt-3 p-3 bg-red-50/60 border border-red-200 rounded-lg space-y-2">
          <div className="text-sm font-bold text-gray-900">주문 취소 사유</div>
          <ReasonPicker options={ORDER_CANCEL_REASONS} picked={cancelPick} onPick={setCancelPick}
            text={cancelReason} onText={setCancelReason} />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={cancelOrder} disabled={!cancelText}
              className="px-3.5 py-1.5 bg-red-600 text-white rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed">주문 취소 확정</button>
            <button onClick={() => setAskingCancel(false)} className="px-3.5 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm bg-white">닫기</button>
            <span className="text-[0.6875rem] text-gray-500">
              사유를 고르거나 적어야 취소됩니다. 삭제 대신 취소로 처리되어 원본은 보존되고 집계에서만 빠집니다 (되돌리려면 재등록)
            </span>
          </div>
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
            ['결제 상태', payState
              ? `${payState.method && showMethodTag(payState.stage) ? `${PAY_METHOD_TAG_LABEL[payState.method]} · ` : ''}${PAY_STAGE_LABEL[payState.stage]}`
              : STATUS_KO[collectStatus] ?? (collectStatus || '-')],
            ['총금액', `${won(total)}원`],
            ['미수금', `${won(outstanding)}원`],
            ['메모', String(order.memo ?? '-')],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[0.6875rem] text-gray-400">{k}</div>
              <div className="text-gray-800">{v}</div>
            </div>
          ))}
        </div>
        {/* 배송지 (513) — 지점·샘플 품목용. 컬럼이 있는(513 적용) DB에서만 표시 */}
        {'ship_addr1' in order && (() => {
          const filled = hasShip(order as Record<string, unknown>)
          const shipItems = activeItems.filter(it => !it.is_cost && !it.parent_line_no && !it.is_prepayment)
          const missing = !filled && isDirect && !canceled && shipItems.length > 0 && needsShip(shipItems.map(it => it.order_kind))
          if (!filled && !missing) return null
          return (
            <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${missing ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
              <div className="text-[0.6875rem] text-gray-400">배송지 (지점 · 샘플 배송)</div>
              {missing
                ? <div className="text-amber-800 text-xs mt-0.5">배송지 미입력 — 발주서 배송명단에 주소가 비어서 나갑니다. 당일은 수정, 익일 이후는 취소 · 재등록으로 입력하세요.</div>
                : <div className="text-gray-800">{shipText(order as Record<string, unknown>)}</div>}
            </div>
          )
        })()}
        {/* 상담일지 주문 진행 요청으로 입력된 주문 (705) */}
        {consultRequest && (
          <div className="mt-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 inline-block">
            상담일지에서 전환 · {consultRequest.requested_by_name ?? '-'} 요청 → {consultRequest.assignee_name ?? '-'} 진행
          </div>
        )}
        {typeof order.etc === 'string' && order.etc && (
          <div className="mt-2 text-xs text-red-600">{order.etc}</div>
        )}
      </div>

      {/* 개별 배송 명단 (707, 2026-11-09) — 개별 품목이 있는 주문. 상담 전환분은 상담 명단이 연결되어 보인다.
          명단 편집은 주문 수정 가능 여부(당일)와 별개 — 취소된 주문만 잠근다 */}
      {isDirect && (
        <RosterCard
          orderId={id}
          applies={activeItems.some(it => !it.is_cost && !it.parent_line_no && !it.is_prepayment && !SHIP_KINDS.has(it.order_kind ?? '지점'))}
          disabled={canceled}
          subject={[order.order_no, order.order_date].filter(Boolean).map(String).join(' · ') || undefined}
        />
      )}

      {/* 품목 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th className="py-2 px-2.5 text-left font-medium">#</th>
              <th className="py-2 px-2.5 text-left font-medium">품번</th>
              <th className="py-2 px-2.5 text-left font-medium">품명</th>
              <th className="py-2 px-2.5 text-left font-medium">배송종류</th>
              <th className="py-2 px-2.5 text-left font-medium">주문시기</th>
              <th className="py-2 px-2.5 text-left font-medium">매입처</th>
              <th className="py-2 px-2.5 text-right font-medium">판매가</th>
              <th className="py-2 px-2.5 text-right font-medium">갯수</th>
              <th className="py-2 px-2.5 text-right font-medium">배송비</th>
              <th className="py-2 px-2.5 text-right font-medium">판매할인</th>
              <th className="py-2 px-2.5 text-right font-medium">합계</th>
              {showCost && <th className="py-2 px-2.5 text-right font-medium">매입가</th>}
              {showCost && <th className="py-2 px-2.5 text-right font-medium">매입할인</th>}
              {showCost && <th className="py-2 px-2.5 text-right font-medium">매입배송비</th>}
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
                  {it.is_canceled && <span className="ml-1.5 no-underline text-[0.625rem] text-red-400">취소</span>}
                  {it.is_prepayment && <span className="ml-1.5 text-[0.625rem] text-violet-500">선결제</span>}
                  {it.is_vip && <span className="ml-1.5 text-[0.625rem] text-rose-500" title="품명 'VIP' — 매출 · 미수 집계에서 빠짐">VIP</span>}
                </td>
                <td className="py-1.5 px-2.5">{it.order_kind ?? '-'}</td>
                <td className="py-1.5 px-2.5 whitespace-nowrap">{it.order_season || '-'}</td>
                <td className="py-1.5 px-2.5">{it.purchase_vendor_name ?? '-'}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.sale_price)}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{it.quantity}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.shipping_fee)}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">
                  {won(it.discount_amount)}
                  {/* 할인 종류 구분 표기 (704) — 단가 할인은 개당 금액 병기 */}
                  {it.discount_mode === '단가' && (it.discount_unit ?? 0) > 0 && (
                    <div className="text-[0.625rem] text-gray-400">{won(it.discount_unit!)} /개</div>
                  )}
                </td>
                <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold">{won(it.line_total)}</td>
                {showCost && <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.purchase_price)}</td>}
                {showCost && (
                  <td className="py-1.5 px-2.5 text-right tabular-nums">
                    {won(it.purchase_discount ?? 0)}
                    {it.purchase_discount_mode === '단가' && (it.purchase_discount_unit ?? 0) > 0 && (
                      <div className="text-[0.625rem] text-gray-400">{won(it.purchase_discount_unit!)} /개</div>
                    )}
                  </td>
                )}
                {showCost && <td className="py-1.5 px-2.5 text-right tabular-nums">{won(it.purchase_shipping ?? 0)}</td>}
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
          {showCost && (
            <span className="text-gray-500">
              매입 합계 <span className="tabular-nums">{won(cost)}원</span>
              {costShipping > 0 && <span className="text-gray-400"> (매입배송비 <span className="tabular-nums">{won(costShipping)}원</span> 포함)</span>}
              {costDiscount > 0 && <span className="text-gray-400"> (매입할인 <span className="tabular-nums">-{won(costDiscount)}원</span> 반영)</span>}
            </span>
          )}
          {showCost && <span className="text-emerald-700">예상 마진 <b className="tabular-nums">{won(total - cost)}원</b></span>}
        </div>
      </div>

      {/* 결제 내역 (2026-11-04 사용자 확정 — 1단계): 수금 매칭·계산서 연결 표기 전용.
          회계 화면으로의 링크·조작은 두지 않는다 (주문 화면에서 회계 영역 이동 불가 결정) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <div className="text-sm font-bold text-gray-900">결제 내역</div>
          <span className="text-[0.6875rem] text-gray-400">수금 · 계산서 연결이 자동으로 표시됩니다 · 선결제 사용은 여기서 처리</span>
          <span className="ml-auto text-sm text-gray-700">
            <span title="취소·VIP·선결제 품목을 뺀 금액 (미수 계산 기준)">{receivable ? '순매출' : '총금액'}</span>{' '}
            <b className="tabular-nums">{won(salesBase)}원</b>
            <span className="mx-1 text-gray-300">·</span>
            수금 <b className="tabular-nums text-emerald-700">{won(collectedAmt)}원</b>
            <span className="mx-1 text-gray-300">·</span>
            미수 <b className={`tabular-nums ${outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {won(outstanding)}원</b>
          </span>
          {/* 선결제 사용 (514) — 잔액이 있을 때만. 한도 = 잔액 · 미수 중 작은 값 */}
          {prepay && prepay.balance > 0 && (
            <span className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded-lg bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-800">
                선결제 잔액 <b className="tabular-nums">{won(prepay.balance)}원</b>
              </span>
              {prepay.can_use && outstanding > 0 && (
                <button onClick={() => { setPrepayOpen(true); setPrepayErr(null); setPrepayAmt(String(Math.min(prepay.balance, outstanding))) }}
                  className="text-xs px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 font-semibold hover:bg-violet-100">
                  선결제 사용
                </button>
              )}
            </span>
          )}
        </div>
        {prepayOpen && prepay && (
          <div className="mb-3 p-3 border border-violet-200 bg-violet-50/40 rounded-lg">
            <div className="text-sm font-semibold text-gray-900 mb-2">
              선결제 사용 — {[order.bank_name, order.branch_name].filter(Boolean).join(' ')}
            </div>
            <div className="flex gap-4 flex-wrap text-xs text-gray-600 mb-2">
              <span>선결제 잔액 <b className="tabular-nums text-gray-900">{won(prepay.balance)}원</b>
                <span className="text-gray-400"> (입금 {won(prepay.deposit)} · 사용 {won(prepay.deduction)})</span></span>
              <span>이 주문 미수 <b className="tabular-nums text-red-600">{won(outstanding)}원</b></span>
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label className="block text-[0.6875rem] text-gray-500 mb-0.5">사용 금액</label>
                <div className="flex gap-1">
                  <input value={prepayAmt} onChange={e => setPrepayAmt(e.target.value.replace(/[^\d,]/g, ''))}
                    className="w-36 border border-amber-300 bg-amber-50 rounded-lg px-2.5 py-1.5 text-sm text-right font-semibold tabular-nums" />
                  <button type="button" onClick={() => setPrepayAmt(String(Math.min(prepay.balance, outstanding)))}
                    className="px-2 py-1 text-xs border border-gray-300 rounded-lg text-gray-600 bg-white">전액</button>
                </div>
              </div>
              <div className="flex-1 min-w-[12rem]">
                <label className="block text-[0.6875rem] text-gray-500 mb-0.5">메모 (선택)</label>
                <input value={prepayMemo} onChange={e => setPrepayMemo(e.target.value)} placeholder="예: 11/1 선결제분에서 차감"
                  className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white" />
              </div>
              <button onClick={() => setPrepayOpen(false)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">취소</button>
              <button onClick={submitPrepay} disabled={prepayBusy}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">
                {prepayBusy ? '처리 중...' : `사용 (${won(Number(prepayAmt.replace(/,/g, '')) || 0)}원)`}
              </button>
            </div>
            <div className="mt-1.5 text-[0.6875rem] text-gray-400">최대 {won(Math.min(prepay.balance, outstanding))}원 (잔액과 미수 중 작은 값). 사용분은 수금으로 계산되고 매출처 선결제 원장에 &lsquo;사용&rsquo;으로 남습니다.</div>
            {prepayErr && <div className="mt-1.5 text-xs text-red-600">{prepayErr}</div>}
          </div>
        )}
        {/* 결제 기록 (1300) — 1차 수기 입력. 아래 목록은 실제 수금(2차 확인 · 직접 매칭)과 계산서 연결 */}
        {!canceled && <PayRecords orderId={String(id)} data={payRecords} outstanding={outstanding} onChanged={load} />}
        {payRecords.available && <div className="text-xs font-semibold text-gray-700 mb-1.5">실제 수금 · 계산서</div>}
        {payments.matches.length === 0 && payments.invoices.length === 0 ? (
          <div className="text-xs text-gray-400 py-1.5">연결된 결제 내역이 아직 없습니다.</div>
        ) : (
          <div className="space-y-1.5 text-sm">
            {payments.matches.map(m => (
              <div key={m.id} className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[0.6875rem] text-gray-400 tabular-nums w-20">{m.paid_date}</span>
                <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${
                  m.source_type === 'bank' ? 'bg-blue-50 text-blue-700'
                    : m.source_type === 'card' ? 'bg-violet-50 text-violet-700'
                      : m.source_type === 'prepay' ? 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200'
                        : 'bg-emerald-50 text-emerald-700'}`}>
                  {m.source_type === 'bank' ? '통장' : m.source_type === 'card' ? '카드' : m.source_type === 'prepay' ? '선결제' : '현금'}
                </span>
                <b className="tabular-nums">{won(m.amount)}원</b>
                {m.source && (
                  <span className="text-xs text-gray-500">
                    {m.source.label}
                    {m.source.total > 0 && m.source.total !== m.amount && (
                      <span className="text-gray-400"> — 원거래 {won(m.source.total)}원 중 이 주문 분배분</span>
                    )}
                  </span>
                )}
                {m.matched_by === 'auto' && <span className="text-[0.625rem] text-gray-400">자동 매칭</span>}
                {m.record_id && <span className="text-[0.625rem] px-1 py-0.5 rounded bg-green-50 text-green-700">결제 기록 매칭분</span>}
                {m.memo && <span className="text-xs text-gray-400">{m.memo}</span>}
                {m.source_type === 'prepay' && prepay?.can_use && (
                  <button onClick={() => releasePrepay(m.id, m.amount)}
                    className="ml-auto text-[0.6875rem] px-2 py-0.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">해제</button>
                )}
              </div>
            ))}
            {payments.invoices.map(v => (
              <div key={v.id} className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[0.6875rem] text-gray-400 tabular-nums w-20">{v.issue_date}</span>
                <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium bg-amber-50 text-amber-700">계산서</span>
                <b className="tabular-nums">{won(v.amount)}원</b>
                {v.invoice_total != null && v.invoice_total !== v.amount && (
                  <span className="text-xs text-gray-400">발행 {won(v.invoice_total)}원 중 이 주문 분배분</span>
                )}
                <span className={`text-xs ${
                  v.invoice_total != null && v.paid_sum >= v.invoice_total ? 'text-emerald-700'
                    : v.paid_sum > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {v.invoice_total != null && v.paid_sum >= v.invoice_total
                    ? `입금 완료${v.paid_last_date ? ` (${v.paid_last_date})` : ''}`
                    : v.paid_sum > 0 ? `부분 입금 ${won(v.paid_sum)}원` : '입금 대기'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 발주 (3단계) — direct 주문만. 업로드 주문은 기존 ERP에서 발주 완료된 건.
          취소 주문은 새 발주를 막기 위해 숨긴다 (기존 발주서는 발주서 이력에서 확인) */}
      {isDirect && showCost && !canceled && <PurchaseSection orderId={String(id)} />}

      {/* 완료 회신 (515) — 요청 건 · 상담자 ≠ 입력자 주문. 처리한 직원이 요청자 · 상담자에게 결과 회신 */}
      {reply?.target && !canceled && (
        <ReplyCard orderId={String(id)} reply={reply} onSaved={load} summary={{
          orderNo: String(order.order_no ?? ''),
          where: [order.bank_name, order.branch_name].filter(Boolean).join(' '),
          customer: String(order.manager_name ?? ''),
          total,
          ship: hasShip(order as Record<string, unknown>) ? shipText(order as Record<string, unknown>) : '',
        }} />
      )}

      {/* 변경 이력 (511) — 접이식: 누가·언제·무엇을 어떻게 바꿨는지 */}
      {editLogs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
          <button onClick={() => setShowLogs(v => !v)}
            className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            변경 이력 <span className="text-[0.6875rem] font-normal text-gray-400">{editLogs.length}건</span>
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
            수정·취소 요청 이력 <span className="text-[0.6875rem] font-normal text-gray-400">과거 승인 제도 기록 — 현재는 취소·재등록 방식</span>
          </div>
          <div className="space-y-1.5">
            {requests.map(r => {
              const s = REQ_STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-500' }
              return (
                <div key={r.id} className="flex items-center gap-2.5 text-sm flex-wrap">
                  <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${s.cls}`}>{s.label}</span>
                  <span className="text-[0.6875rem] text-gray-400">{r.request_type === 'cancel' ? '취소' : '수정'}</span>
                  <span className="text-gray-700">{r.reason}</span>
                  {r.decision_memo && <span className="text-xs text-gray-400">→ {r.decision_memo}</span>}
                  <span className="text-[0.6875rem] text-gray-300 tabular-nums ml-auto">{r.created_at.slice(0, 10)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
