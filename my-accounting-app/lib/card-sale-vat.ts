// 카드매출 · 현금영수증의 공급가 · 세액 판정 — 월별 손익 · 예상부가세 · 카드매출 분개가 함께 쓰는 단일 규칙.
//
// 2026-11-12 사용자 결정: 공급가 · 세액이 모두 0인 건(구분 미기재 — 수기결제 PG 파일 등)은 과세로 보고 1.1로 나눈다.
//   공급가 = round(|금액| / 1.1) (부호 유지), 세액 = 금액 − 공급가 (마이그레이션 400 보정식과 같다)
// 원본(card_sales.supply_amount · tax_amount)은 0 그대로 둔다 — "미기재"가 계속 식별돼야 나중에 과세 · 면세를
// 분류할 수 있다(사용자: 나중에 분류할 가능성 있음). 분류 기능을 만들면 그 값을 이 함수에서 먼저 보도록 확장하고,
// 분류 뒤에는 syncCardSaleJournal(멱등)로 분개를 다시 맞춘다.
export type VatKind = 'taxable' | 'exempt' | 'unknown'

export interface VatSplit {
  supply: number
  tax: number
  kind: VatKind      // unknown = 구분 미기재(과세로 보고 분할)
}

export function splitVat(amount: number | null, supply: number | null, tax: number | null): VatSplit {
  const amt = amount || 0, sup = supply || 0, tx = tax || 0
  if (tx !== 0) return { supply: sup !== 0 ? sup : amt - tx, tax: tx, kind: 'taxable' }
  if (sup !== 0) return { supply: sup, tax: 0, kind: 'exempt' }
  if (amt === 0) return { supply: 0, tax: 0, kind: 'taxable' }
  const s = Math.sign(amt) * Math.round(Math.abs(amt) / 1.1)
  return { supply: s, tax: amt - s, kind: 'unknown' }
}

export const VAT_UNKNOWN_NOTE = '공급가·세액 미기재 — 과세로 보고 1.1 분할 (2026-11-12 결정)'
