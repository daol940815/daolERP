// ── 미수금 단일 정의 (JS 측) ──────────────────────────────────
// DB의 v_erp_order_receivable(마이그레이션 406)과 **같은 규칙**을 구현한다.
// 화면마다 미수를 다르게 계산하던 문제를 없애기 위한 단일 출처 —
// 미수를 계산하는 새 코드는 반드시 이 파일의 함수를 쓸 것.
//
// 표준 규칙
//   수금완료(collect_status='collected') → 0
//   그 외 → min( max(0, 원본미수 − 컷오프 통과 매칭), 순매출 )
//
//   · 컷오프 통과 매칭: upload 주문(기존 ERP 업로드)은 마지막 업로드(updated_at)
//     이후 입금만 차감한다. 업로드 이전 입금은 ERP가 들고 온 outstanding_amount에
//     이미 반영돼 있어 다시 빼면 이중차감이다. direct 주문(자체 주문시스템)은
//     재업로드가 없으므로 전액 차감.
//   · 순매출 상한: 취소·VIP·선결제를 뺀 금액보다 미수가 클 수는 없다.
//   · 수금완료=0: ERP에서 수금완료로 표시한 주문은 잔액이 남아 있어도 받을 돈이 아니다.
//
// 규칙을 바꿀 때는 이 파일과 406 뷰를 **함께** 고쳐야 한다.

export type ReceivableOrderLike = {
  total_amount?: number | null
  outstanding_amount?: number | null
  collect_status?: string | null
  source?: string | null
  updated_at?: string | null
}

export type PayEvent = { amount: number; paid_date: string | null }

export type ReceivableItemLike = {
  line_total?: number | null
  is_canceled?: boolean | null
  is_vip?: boolean | null
  is_prepayment?: boolean | null
}

/** 집계 제외 품목(취소·VIP·선결제) 합계 */
export function excludedTotal(items: ReceivableItemLike[] | undefined): number {
  if (!items?.length) return 0
  let sum = 0
  for (const it of items) {
    if (it.is_canceled || it.is_vip || it.is_prepayment) sum += it.line_total ?? 0
  }
  return sum
}

/** 순매출 = max(0, 총액 − 제외금액) */
export function netSalesOf(o: ReceivableOrderLike, excluded: number): number {
  return Math.max(0, (o.total_amount ?? 0) - excluded)
}

/** 컷오프를 통과해 실제로 차감되는 매칭 입금액 */
export function cutoffAlloc(o: ReceivableOrderLike, events: PayEvent[] | undefined): number {
  if (!events?.length) return 0
  const isDirect = (o.source ?? 'upload') === 'direct'
  const cut = (o.updated_at ?? '').slice(0, 10)
  let sum = 0
  for (const e of events) {
    if (isDirect || (e.paid_date && cut && e.paid_date > cut)) sum += e.amount
  }
  return sum
}

/** 표준 미수 (구성요소를 이미 들고 있을 때) */
export function outstandingOf(
  o: ReceivableOrderLike,
  opts: { net: number; alloc: number },
): number {
  if (o.collect_status === 'collected') return 0
  return Math.min(Math.max(0, (o.outstanding_amount ?? 0) - opts.alloc), opts.net)
}

/** 표준 미수 (품목·매칭 원본에서 한 번에) */
export function orderOutstanding(
  o: ReceivableOrderLike,
  items: ReceivableItemLike[] | undefined,
  events: PayEvent[] | undefined,
): number {
  const excluded = excludedTotal(items)
  return outstandingOf(o, { net: netSalesOf(o, excluded), alloc: cutoffAlloc(o, events) })
}
