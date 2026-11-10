// 품목 마진 계산 — 품목 관리 화면 · 원가표 다운로드 공용 (2026-11-10 시안 확정, docs/product-master-track.md)
//
// 지점 마진: 이익금 = 지점판매가 − 매입가 − 카톤택배비 ÷ 카톤단위
//            마진율 = 이익금 ÷ 지점판매가
// 개별 마진: 이익금 = 개별판매가 − (매입가 + 카톤외택배비)   — 개별 1개 = 낱개 1건 배송이라 카톤외택배비 전액을 1개에 붙임
//            마진율 = 이익금 ÷ 개별판매가
// 금액은 모두 VAT 포함 그대로. 계산은 반올림 전 값, 표시만 반올림(이익금 원 · 마진율 소수 첫째 자리).
// 판매가 없음(0): 지점은 이익금만(마진율 null), 개별은 전체 null(개별로 팔지 않는 품목).
// 카톤단위가 비었거나 1 미만이면 카톤택배비 몫은 0 — 501 설계('빈값 · 0 = 카톤 미사용')와 주문 입력 자동 배송비 규칙과 같음.
// 주문 · 상담 화면의 마진은 별도(입력 당시 값 기준)이며 이 함수를 쓰지 않는다.

export interface MarginInput {
  sale_price: number | null
  individual_sale_price?: number | null
  purchase_price: number | null
  carton_unit?: number | null
  carton_shipping_fee?: number | null
  loose_shipping_fee?: number | null
}

export interface Margin {
  profit: number          // 이익금 (반올림 전)
  rate: number | null     // 마진율 0~1 (반올림 전), 판매가 없으면 null
}

export function branchMargin(p: MarginInput): Margin {
  const sale = p.sale_price ?? 0
  const unit = p.carton_unit ?? 0
  const perUnitShip = unit >= 1 ? (p.carton_shipping_fee ?? 0) / unit : 0
  const profit = sale - (p.purchase_price ?? 0) - perUnitShip
  return { profit, rate: sale > 0 ? profit / sale : null }
}

export function individualMargin(p: MarginInput): Margin | null {
  const sale = p.individual_sale_price ?? 0
  if (!(sale > 0)) return null
  const profit = sale - ((p.purchase_price ?? 0) + (p.loose_shipping_fee ?? 0))
  return { profit, rate: profit / sale }
}

/** 이익금 표시: 원 단위 반올림 — "1,420원" */
export function formatProfit(profit: number): string {
  const n = Math.round(profit)
  return `${(n === 0 ? 0 : n).toLocaleString('ko-KR')}원`
}

/** 마진율 표시: 소수 첫째 자리 — "31.6%", 판매가 없으면 "-" */
export function formatRate(rate: number | null): string {
  if (rate === null) return '-'
  const v = Math.round(rate * 1000) / 10
  return `${(v === 0 ? 0 : v).toFixed(1)}%`
}
