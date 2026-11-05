// 배송지 공용 정의 (513, 2026-11-04 사용자 확정 — 시안 docs/mockups/배송지_주문서_시안.html)
// 서버(주문 저장·발주서)와 화면(주문서·상세)이 같이 쓰는 순수 함수만 둔다.
//  - 주소는 주문(erp_orders.ship_*)에 저장. 매출처 마스터는 건드리지 않는다
//  - 지점·샘플 품목에만 적용, 개별 배송은 발주서 배송명단 수기(2단계 명단 업로드)
//  - 선택 항목: 비어 있으면 저장은 되고 화면에 "배송지 미입력" 경고만

export interface ShipInput {
  ship_name: string | null
  ship_phone: string | null
  ship_zip: string | null
  ship_addr1: string | null
  ship_addr2: string | null
}
export const SHIP_KEYS = ['ship_name', 'ship_phone', 'ship_zip', 'ship_addr1', 'ship_addr2'] as const
export const hasShip = (s: Partial<ShipInput> | null | undefined) =>
  !!s && SHIP_KEYS.some(k => !!(s[k] ?? '').toString().trim())
// 표시 문자열: 권오병 부장님 · 010-... · (10381) 경기 ... 2층
export function shipText(s: Partial<Record<(typeof SHIP_KEYS)[number], unknown>> | null | undefined): string {
  if (!s) return ''
  const addr = [s.ship_zip ? `(${s.ship_zip})` : '', s.ship_addr1, s.ship_addr2].filter(Boolean).join(' ')
  return [s.ship_name, s.ship_phone, addr].map(v => String(v ?? '').trim()).filter(Boolean).join(' · ')
}
// 배송지를 받는 품목 구분 — 개별 배송은 수령인별 명단(수기)
export const SHIP_KINDS = new Set(['지점', '샘플'])

// 이 주문(품목 구분 목록)이 배송지를 받는지 — 품목이 아직 없으면 받는 것으로 본다
export const needsShip = (kinds: (string | null | undefined)[]) =>
  kinds.length === 0 || kinds.some(k => SHIP_KINDS.has(k ?? '지점'))

// 발주서 한 줄 주소: (10381) 경기 ... 2층
export const shipAddrLine = (s: Partial<ShipInput> | null | undefined) =>
  !s ? '' : [s.ship_zip ? `(${s.ship_zip})` : '', s.ship_addr1, s.ship_addr2].filter(Boolean).join(' ')
