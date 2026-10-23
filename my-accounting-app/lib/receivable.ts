// ── 미수금 단일 정의 (JS 측) ──────────────────────────────────
// DB의 v_erp_order_receivable(마이그레이션 406)과 **같은 규칙**을 구현한다.
// 화면마다 미수를 다르게 계산하던 문제를 없애기 위한 단일 출처 —
// 미수를 계산하는 새 코드는 반드시 이 파일의 함수를 쓸 것.
//
// 표준 규칙
//   순매출 = Σ(취소·VIP·선결제가 아닌 품목의 line_total)   ← 품목에서 직접 더한다
//   수금완료(collect_status='collected') → 0
//   그 외 → min( max(0, 원본미수 − 컷오프 통과 매칭), max(0, 순매출) )
//
//   · 순매출을 품목에서 더하는 이유 (2026-10-01 데이터로 확정):
//     `erp_orders.total_amount`는 주문마다 의미가 다르다 — 8,635건 중 7,938건은
//     제외 품목이 빠진 금액이고 697건은 포함된 금액이다. 그래서 `총액 − 제외`도,
//     `총액` 그대로도 어느 쪽도 맞지 않는다. 품목 합만이 월별 손익(025)과
//     월 단위로 정확히 일치한다. total_amount는 참고용으로만 쓴다.
//   · 반품·정정 주문(총액 음수 219건)이 있으므로 순매출에는 0 하한을 두지 않는다
//     — 하한을 두면 반품이 매출에서 사라진다. 025도 하한이 없다.
//   · 컷오프 통과 매칭: upload 주문(기존 ERP 업로드)은 마지막 업로드(updated_at)
//     이후 입금만 차감한다. 업로드 이전 입금은 ERP가 들고 온 outstanding_amount에
//     이미 반영돼 있어 다시 빼면 이중차감이다. direct 주문(자체 주문시스템)은
//     재업로드가 없으므로 전액 차감.
//   · 미수 상한: 매출이 없는 주문(전액 VIP·선결제)에는 미수도 없다. 상한에는
//     0 하한을 걸어 순매출이 음수여도 미수가 음수가 되지 않게 한다.
//   · 수금완료=0: ERP에서 수금완료로 표시한 주문은 잔액이 남아 있어도 받을 돈이 아니다.
//
// 규칙을 바꿀 때는 이 파일과 뷰 v_erp_order_receivable을 **함께** 고쳐야 한다.

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

/** 집계 제외 품목(취소·VIP·선결제) 합계 — 참고·표시용 */
export function excludedTotal(items: ReceivableItemLike[] | undefined): number {
  if (!items?.length) return 0
  let sum = 0
  for (const it of items) {
    if (it.is_canceled || it.is_vip || it.is_prepayment) sum += it.line_total ?? 0
  }
  return sum
}

/** 순매출 = Σ(비제외 품목 line_total). 하한 없음(반품 음수 보존), 월별 손익 025와 동일. */
export function netSalesOf(items: ReceivableItemLike[] | undefined): number {
  if (!items?.length) return 0
  let sum = 0
  for (const it of items) {
    if (it.is_canceled || it.is_vip || it.is_prepayment) continue
    sum += it.line_total ?? 0
  }
  return sum
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
  return Math.min(
    Math.max(0, (o.outstanding_amount ?? 0) - opts.alloc),
    Math.max(0, opts.net),
  )
}

/** 표준 미수 (품목·매칭 원본에서 한 번에) */
export function orderOutstanding(
  o: ReceivableOrderLike,
  items: ReceivableItemLike[] | undefined,
  events: PayEvent[] | undefined,
): number {
  return outstandingOf(o, { net: netSalesOf(items), alloc: cutoffAlloc(o, events) })
}
