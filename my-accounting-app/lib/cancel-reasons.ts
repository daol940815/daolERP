// 취소 · 종결 · 삭제 사유 (2026-11-10 사용자 결정 — 셋 다 사유 필수)
//  - 빠른 선택 버튼 목록. '기타'를 고르면 직접 입력이 필수다.
//  - 저장 값: "버튼 · 덧붙인 글" (기타면 덧붙인 글만). 화면 · 엑셀 · 업무일지에 그대로 보인다.
//  - 목록을 바꿀 때는 여기만 고친다 (화면은 이 목록을 그대로 그린다).

export const ORDER_CANCEL_REASONS = ['고객 취소 요청', '입력 실수', '중복 입력', '품절 · 공급 불가', '기타'] as const
export const CONSULT_CLOSE_REASONS = ['고객 미주문', '타사 구매', '단순 문의', '예산 · 일정 보류', '다른 상담과 중복', '기타'] as const
export const CONSULT_DELETE_REASONS = ['잘못 작성', '중복 작성', '다른 고객으로 작성', '기타'] as const

export const REASON_OTHER = '기타'
export const REASON_MAX = 300

// 버튼 + 덧붙인 글 → 저장 값. 비어 있으면 '' (저장 불가)
export function composeReason(picked: string | null, text: string): string {
  const t = text.trim()
  if (picked === REASON_OTHER) return t.slice(0, REASON_MAX)
  return [picked, t].filter(Boolean).join(' · ').slice(0, REASON_MAX)
}
