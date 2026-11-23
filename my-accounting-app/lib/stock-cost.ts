// 재고 칸 · 마진 원가 — 화면 · 서버 공용 (재고 관리 트랙 1400, docs/inventory-track.md)
//
// 두 칸이 각자 한 뜻만 갖는다 (2026-11-23 사용자 결정):
//   purchase_total(매입합계) = 매입처에 줄 돈 — 매입처 대사 · 미지급금 · 매입 사이클이 읽는다. 이 파일의 원가 식을 쓰지 않는다.
//   stock_cost(재고 원가)    = 재고에서 나간 물건의 원가(선입선출, 저장 시 고정).
// 마진 원가 = 매입합계 + 재고 원가. 선매입 입고 행은 마진 · 원가 집계에서 뺀다(판매가 0 · 재고로 보관).
// 마진을 계산하는 곳은 반드시 marginCostOf / inMargin 을 거칠 것 (DB 쪽은 1400의 monthly_pl_order_summary · vendor_sales_analysis).

export type StockRole = 'in' | 'out'

export const STOCK_ROLE_LABEL: Record<StockRole, string> = { in: '선매입 입고', out: '재고 출고' }

export const toStockRole = (v: unknown): StockRole | null => (v === 'in' || v === 'out' ? v : null)

interface CostLike {
  stock_role?: string | null
  purchase_total?: number | null
  stock_cost?: number | null
}

/** 마진 집계에 들어가는 행인가 — 선매입 입고 행은 빠진다 */
export const inMargin = (it: CostLike) => it.stock_role !== 'in'

/** 마진 원가 = 매입합계 + 재고 원가 (선매입 입고 행은 0) */
export const marginCostOf = (it: CostLike): number =>
  inMargin(it) ? (Number(it.purchase_total) || 0) + (Number(it.stock_cost) || 0) : 0

/** 재고 출고 행인데 재고 원가가 아직 없다(배정 전 · 재고 부족) — 확인 필요 표시용 */
export const stockCostPending = (it: CostLike) => it.stock_role === 'out' && it.stock_cost == null

// 재고 금액 → 손익용 공급가액. 주문 매입가는 부가세 포함, 증빙 원가는 공급가액이라 과세 품목은 ÷ 1.1.
// 품목의 과세 · 면세 구분이 아직 없어(2026-11-23 확인 — erp_products에 칸 없음, 미결 3) 지금은 전부 과세로 본다.
export const STOCK_VAT_NOTE = '품목 과세 · 면세 구분이 아직 없어 전부 과세(÷ 1.1)로 계산합니다'
export const supplyOfStock = (amount: number) => Math.round(amount / 1.1)

/** 선입선출 미리보기 (주문 입력 화면 — 저장 전 예상 재고 원가). 실제 값은 저장 때 DB 함수가 다시 계산한다 */
export function previewFifo(lots: { remaining: number; unit_cost: number; date: string }[], qty: number) {
  let left = qty
  const parts: { date: string; qty: number; unit_cost: number; amount: number }[] = []
  for (const l of lots) {
    if (left <= 0) break
    const take = Math.min(left, l.remaining)
    if (take <= 0) continue
    parts.push({ date: l.date, qty: take, unit_cost: l.unit_cost, amount: Math.round(take * l.unit_cost) })
    left -= take
  }
  return { parts, short: Math.max(0, left), cost: parts.reduce((s, p) => s + p.amount, 0) }
}
