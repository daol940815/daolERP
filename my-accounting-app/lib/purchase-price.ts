// 매입가 소수점 (2026-11-16 사용자 결정 — 가안, 마이그레이션 518).
// 매입가(purchase_price)만 소수 둘째 자리까지 저장한다 — 업체 원가표의 462.2원 같은 단가를 그대로 쓰기 위해.
// 매입금액 · 매입합계 · 발주 합계 · 마진은 지금처럼 원 단위 정수: 매입가 × 수량을 원 단위로 반올림(462.2 × 1,000 = 462,200).
// 판매가 · 수량 · 배송비 · 할인은 정수 그대로. 화면 · 서버 · 엑셀이 이 파일 하나를 쓴다(순수 함수만).

// 저장 값: 소수 둘째 자리까지 (셋째 자리에서 반올림)
export function toPurchasePrice(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

// 매입금액 = 매입가 × 수량, 원 단위 반올림 (부동소수 오차 없이 '전' 단위 정수로 곱한다)
export function purchaseAmount(price: number | null | undefined, qty: number | null | undefined): number {
  const cents = Math.round((Number(price) || 0) * 100)
  return Math.round((cents * (Number(qty) || 0)) / 100)
}

// 화면 표시: 소수가 있을 때만 보인다 (462 / 462.2 / 462.25)
export const fmtPurchasePrice = (n: number | null | undefined): string =>
  (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })

// 엑셀 서식: 정수면 지금처럼 '#,##0', 소수면 '#,##0.0#' (462.2 · 462.25)
export const purchasePriceNumFmt = (n: number | null | undefined): string =>
  Number.isInteger(Number(n) || 0) ? '#,##0' : '#,##0.0#'
