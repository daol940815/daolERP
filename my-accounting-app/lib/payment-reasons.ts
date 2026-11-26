// 결제 기록 취소 · 삭제 · 수정 사유 항목 (1305, 2026-11-18 사용자 확정 — 초안대로)
// 화면: 글자를 치면 label · keywords 로 걸러지는 드롭다운에서 고른다. 'etc'(기타)는 직접 입력이 필수.
// 항목을 고치려면 여기만 고친다(저장은 code + 표시 문구). 클라이언트에서도 쓴다.
export type ReasonKind = 'cancel' | 'delete' | 'update' | 'release' | 'settle' | 'unsettle' | 'stock_out' | 'stock_confirm' | 'stock_adjust' | 'no_evidence' | 'no_evidence_release'
export interface ReasonItem { code: string; label: string; keywords?: string }

export const REASONS: Record<ReasonKind, ReasonItem[]> = {
  cancel: [
    { code: 'customer', label: '고객 요청', keywords: '고객 변심 요청' },
    { code: 'method_change', label: '결제 수단 변경(다른 카드 · 이체로)', keywords: '카드 변경 이체 수단 다른' },
    { code: 'amount_change', label: '금액 변경 후 재결제', keywords: '금액 재결제 변경' },
    { code: 'order_cancel', label: '주문 취소 · 반품', keywords: '주문 취소 반품 환불' },
    { code: 'duplicate', label: '중복 결제', keywords: '중복 두 번 카드' },
    { code: 'vat_window', label: '과세 · 면세 창구 오류', keywords: '과세 면세 창구 구분' },
    { code: 'invoice_fix', label: '계산서 정정 발행', keywords: '계산서 정정 수정 발행 재발행' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  delete: [
    { code: 'wrong_order', label: '잘못 입력(다른 주문)', keywords: '다른 주문 잘못' },
    { code: 'duplicate', label: '중복 입력', keywords: '중복 두 번' },
    { code: 'amount', label: '금액 오기재', keywords: '금액 오타' },
    { code: 'method', label: '수단 오기재', keywords: '수단 카드 이체 계산서' },
    { code: 'test', label: '테스트 입력', keywords: '테스트 연습' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  update: [
    { code: 'amount', label: '금액 오기재', keywords: '금액 오타' },
    { code: 'clue', label: '승인번호 · 입금자 오타', keywords: '승인번호 입금자 카드 뒤 오타' },
    { code: 'date', label: '결제일 오기재', keywords: '날짜 결제일 발행일' },
    { code: 'method', label: '수단 · 구분 오기재', keywords: '수단 구분 과세 면세 단말기 수기' },
    { code: 'allocation', label: '주문 배분 변경', keywords: '주문 배분 합산 분할' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  // 이전 처리분 표시 · 해제 — 1309, 2026-11-23 (주문 없이 이미 처리된 입금 · 카드 결제)
  settle: [
    { code: 'legacy_erp', label: '기존 ERP에서 처리 완료', keywords: '기존 ERP 이전 처리 완료' },
    { code: 'prepay_ledger', label: '선결제 원장에 이미 반영됨', keywords: '선결제 원장 반영' },
    { code: 'not_order', label: '주문과 무관한 입금(내부 이체 · 이자 · 환급 등)', keywords: '무관 내부 이체 이자 환급' },
    { code: 'wrong_payer', label: '다른 회사 · 개인 입금(잘못 들어온 돈)', keywords: '잘못 다른 회사 개인 오입금' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  unsettle: [
    { code: 'needs_order', label: '주문에 붙여야 할 입금이었음', keywords: '주문 붙여야 매칭' },
    { code: 'wrong_item', label: '다른 입금을 잘못 표시함', keywords: '잘못 다른 입금' },
    { code: 'wrong_reason', label: '사유를 잘못 고름(다시 표시 예정)', keywords: '사유 잘못 다시' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  // 매칭 해제(2차 확정을 되돌림) — 1307, 2026-11-18
  release: [
    { code: 'wrong_source', label: '다른 입금 · 결제에 잘못 매칭', keywords: '잘못 다른 입금 카드 결제 원본' },
    { code: 'wrong_order', label: '다른 주문의 입금 · 결제', keywords: '다른 주문 잘못' },
    { code: 'amount', label: '금액을 잘못 배분', keywords: '금액 배분 잘못' },
    { code: 'record_fix', label: '결제 기록 수정 필요(입력자 요청)', keywords: '기록 수정 입력자 요청 오기재' },
    { code: 'duplicate', label: '중복 매칭', keywords: '중복 두 번' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  // 증빙 없이 처리 · 해제 — 1310, 2026-11-25 (계산서 · 현금영수증 없이 통장으로 받은 주문)
  no_evidence: [
    { code: 'customer_declined', label: '고객이 발행을 원하지 않음', keywords: '고객 원하지 않음 불필요 발행 안 함' },
    { code: 'individual', label: '개인 고객', keywords: '개인 고객 직원 개인' },
    { code: 'small', label: '소액', keywords: '소액 금액 작음' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  no_evidence_release: [
    { code: 'evidence_issued', label: '계산서 · 현금영수증을 발행함', keywords: '계산서 현금영수증 발행 증빙 생김' },
    { code: 'wrong_vat', label: '과세 구분을 잘못 고름(다시 처리 예정)', keywords: '과세 면세 구분 잘못' },
    { code: 'wrong_order', label: '다른 주문을 잘못 처리함', keywords: '잘못 다른 주문' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  // 재고 관리 확인 필요 탭 (1401, 2026-11-23 — 재고 관리 트랙)
  stock_out: [
    { code: 'from_stock', label: '사무실 선매입 재고에서 보냄(매입 중복)', keywords: '재고 사무실 중복 매입가 두 번' },
    { code: 'input_miss', label: '입력할 때 재고 칸을 빠뜨림', keywords: '실수 누락 빠뜨림 입력' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  stock_confirm: [
    { code: 'new_buy', label: '실제로 새로 매입함(재고와 별개)', keywords: '새로 매입 별개 추가 구매' },
    { code: 'diff_spec', label: '같은 품번이지만 다른 사양 · 구성', keywords: '사양 구성 옵션 다름' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
  stock_adjust: [
    { code: 'damage', label: '파손 · 불량', keywords: '파손 불량 깨짐' },
    { code: 'lost', label: '분실', keywords: '분실 없어짐' },
    { code: 'out_missing', label: '출고 기록 누락(주문 없이 나감)', keywords: '출고 누락 주문 없이 샘플' },
    { code: 'in_missing', label: '입고 기록 누락 · 수량 차이', keywords: '입고 누락 수량 더 들어옴' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
}

export interface ReasonInput { code: string; text: string }

// 서버 검증: 항목 코드가 목록에 있어야 하고, 기타는 직접 입력 2자 이상. 표시 문구를 돌려준다.
export function resolveReason(kind: ReasonKind, raw: unknown): { code: string; text: string } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>
  const code = String(b.code ?? '').trim()
  const item = REASONS[kind].find(r => r.code === code)
  const name = kind === 'cancel' ? '취소' : kind === 'delete' ? '삭제' : kind === 'release' ? '매칭 해제' : kind === 'settle' ? '이전 처리분' : kind === 'unsettle' ? '이전 처리분 해제'
    : kind === 'stock_out' ? '재고 출고로 바꾸는' : kind === 'stock_confirm' ? '확인' : kind === 'stock_adjust' ? '조정' : '수정'
  if (!item) return { error: `${name} 사유를 고르세요.` }
  if (code === 'etc') {
    const text = String(b.text ?? '').trim()
    if (text.length < 2) return { error: `${name} 사유(기타)를 직접 입력하세요.` }
    return { code, text: `기타: ${text.slice(0, 200)}` }
  }
  return { code, text: item.label }
}
