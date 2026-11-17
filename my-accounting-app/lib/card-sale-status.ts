// 카드매출 정산상태로 '무효' 판정 (2026-11-17 사용자 승인)
// 단말기 VAN 파일의 정산상태 '중복해제' = 카드사 · VAN이 같은 결제의 중복 승인으로 판정해 해제한 건 — 수금되지 않고 승인도 사라진다.
// 파일에 취소 행이 없어 그대로 두면 매출 · 매출채권이 과대 계상되므로: 분개 제외(전기돼 있으면 전기 취소) · 수금 후보 · 주문 배분 · 예상 부가세 ·
// 월별 손익 근거 · 매출처 대조에서 제외 · 매출 탭 배지. 원본 행은 그대로 둔다(상태가 바뀌어 재업로드되면 자동 복귀).
// 참고: 처리현황 '반송'은 이 VAN 파일에서 정산완료와 함께 찍히는 단계 표기라 무효가 아니다. '정산삭제'는 취소 행이 함께 와서 순액 0.
export const CARD_SALE_VOID_STATUSES = ['중복해제'] as const

export const isCardSaleVoided = (r: { settlement_status?: string | null }) =>
  (CARD_SALE_VOID_STATUSES as readonly string[]).includes((r.settlement_status ?? '').trim())

// PostgREST .or() 조건 — NULL 은 유지하고 무효 상태만 뺀다 (.neq 는 NULL 을 함께 걸러 버린다)
export const NOT_VOID_OR = `settlement_status.is.null,settlement_status.not.in.(${CARD_SALE_VOID_STATUSES.map(s => `"${s}"`).join(',')})`

export const CARD_SALE_VOID_NOTE = '정산상태 중복해제 — 카드사가 중복 승인으로 해제한 건, 수금 없음(전기 제외)'
