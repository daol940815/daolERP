// 결제 기록 취소 · 삭제 · 수정 사유 항목 (1305, 2026-11-18 사용자 확정 — 초안대로)
// 화면: 글자를 치면 label · keywords 로 걸러지는 드롭다운에서 고른다. 'etc'(기타)는 직접 입력이 필수.
// 항목을 고치려면 여기만 고친다(저장은 code + 표시 문구). 클라이언트에서도 쓴다.
export type ReasonKind = 'cancel' | 'delete' | 'update' | 'release'
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
  // 매칭 해제(2차 확정을 되돌림) — 1307, 2026-11-18
  release: [
    { code: 'wrong_source', label: '다른 입금 · 결제에 잘못 매칭', keywords: '잘못 다른 입금 카드 결제 원본' },
    { code: 'wrong_order', label: '다른 주문의 입금 · 결제', keywords: '다른 주문 잘못' },
    { code: 'amount', label: '금액을 잘못 배분', keywords: '금액 배분 잘못' },
    { code: 'record_fix', label: '결제 기록 수정 필요(입력자 요청)', keywords: '기록 수정 입력자 요청 오기재' },
    { code: 'duplicate', label: '중복 매칭', keywords: '중복 두 번' },
    { code: 'etc', label: '기타 — 직접 입력' },
  ],
}

export interface ReasonInput { code: string; text: string }

// 서버 검증: 항목 코드가 목록에 있어야 하고, 기타는 직접 입력 2자 이상. 표시 문구를 돌려준다.
export function resolveReason(kind: ReasonKind, raw: unknown): { code: string; text: string } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>
  const code = String(b.code ?? '').trim()
  const item = REASONS[kind].find(r => r.code === code)
  const name = kind === 'cancel' ? '취소' : kind === 'delete' ? '삭제' : kind === 'release' ? '매칭 해제' : '수정'
  if (!item) return { error: `${name} 사유를 고르세요.` }
  if (code === 'etc') {
    const text = String(b.text ?? '').trim()
    if (text.length < 2) return { error: `${name} 사유(기타)를 직접 입력하세요.` }
    return { code, text: `기타: ${text.slice(0, 200)}` }
  }
  return { code, text: item.label }
}
