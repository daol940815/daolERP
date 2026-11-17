// 카드매출 · 현금영수증의 공급가 · 세액 판정 — 월별 손익 · 예상부가세 · 카드매출 분개가 함께 쓰는 단일 규칙.
//
// 2026-11-12 사용자 결정: 공급가 · 세액이 모두 0인 건(구분 미기재 — 수기결제 PG 파일 등)은 과세로 보고 1.1로 나눈다.
//   공급가 = round(|금액| / 1.1) (부호 유지), 세액 = 금액 − 공급가 (마이그레이션 400 보정식과 같다)
// 원본(card_sales.supply_amount · tax_amount)은 0 그대로 둔다 — "미기재"가 계속 식별돼야 한다.
// 2026-11-17 사용자 확인: 수기결제 파일의 CPID 로 과세 · 면세를 가른다 — CDA23815 = 면세 CP(다올커머스(비과세)), CDA23814 = 과세 CP.
//   업로드가 CPID 규칙으로 card_sales.vat_kind(해석 열, 427)를 채우고, 이 함수는 그 값을 먼저 본다.
//   모르는 CPID 는 면세로 단정하지 않는다(vat_kind NULL → 기존 규칙 = 과세 1.1 분할, 업로드 결과에 '미확인 CPID'로 표시).
export type VatKind = 'taxable' | 'exempt' | 'unknown'

export interface VatSplit {
  supply: number
  tax: number
  kind: VatKind      // unknown = 구분 미기재(과세로 보고 분할)
}

// CPID → 과세 · 면세 규칙 (면세 CP가 더 생기면 여기에 추가 — 사용자 확인 뒤)
export const CPID_VAT_RULES: Record<string, 'taxable' | 'exempt'> = {
  CDA23814: 'taxable',   // 다올커머스 (과세)
  CDA23815: 'exempt',    // 다올커머스(비과세)
}
export const normalizeCpid = (s: string | null | undefined) => (s ?? '').trim().toUpperCase()
export const vatKindOfCpid = (cpid: string | null | undefined): 'taxable' | 'exempt' | null => {
  const k = normalizeCpid(cpid)
  return k ? CPID_VAT_RULES[k] ?? null : null
}

export function splitVat(amount: number | null, supply: number | null, tax: number | null, vatKind?: string | null): VatSplit {
  const amt = amount || 0, sup = supply || 0, tx = tax || 0
  // 해석 열이 있으면 우선 — 면세는 전액 공급가, 과세(공급가 · 세액 미기재)는 1.1 분할하되 '미기재'가 아니라 '과세'로 본다
  if (vatKind === 'exempt') return { supply: amt, tax: 0, kind: 'exempt' }
  if (vatKind === 'taxable' && tx === 0 && sup === 0 && amt !== 0) {
    const s = Math.sign(amt) * Math.round(Math.abs(amt) / 1.1)
    return { supply: s, tax: amt - s, kind: 'taxable' }
  }
  if (tx !== 0) return { supply: sup !== 0 ? sup : amt - tx, tax: tx, kind: 'taxable' }
  if (sup !== 0) return { supply: sup, tax: 0, kind: 'exempt' }
  if (amt === 0) return { supply: 0, tax: 0, kind: 'taxable' }
  const s = Math.sign(amt) * Math.round(Math.abs(amt) / 1.1)
  return { supply: s, tax: amt - s, kind: 'unknown' }
}

export const VAT_UNKNOWN_NOTE = '공급가·세액 미기재 — 과세로 보고 1.1 분할 (2026-11-12 결정)'
export const VAT_EXEMPT_CPID_NOTE = '면세 CP(CPID) — 전액 공급가, 세액 0 (2026-11-17 확인)'
export const VAT_TAXABLE_CPID_NOTE = '과세 CP(CPID) — 1.1 분할'
