// 일반(기한부) 대출의 월 이자(참고) — 현 잔액 × 연이율 ÷ 12, 원 단위 반올림 (2026-11-17 사용자 승인)
// 저장값(loans.monthly_interest)을 그대로 쓰지 않고 볼 때마다 계산한다 — 잔액 · 이율을 고치면 바로 따라간다.
// 이율이 비어 있는 대출만 저장값(직접 입력)을 쓴다. 한도대출(마이너스 통장)은 통장 일별 사용액 기준 계산(lib/loan-interest.ts)이라 여기 대상이 아니다.
// 은행 실제 청구는 일할(잔액 × 이율 × 일수 ÷ 365)이라 달마다 1~3% 차이가 날 수 있다 — '참고' 숫자. 쓰는 곳: 대출 관리 · 대시보드 · 상환 스케줄 · 연간 보고서.

export interface TermInterestInput {
  current_balance: number | null
  interest_rate: number | null
  monthly_interest?: number | null
  product_type?: 'term' | 'credit_line' | null
}

export const termMonthlyInterest = (l: TermInterestInput): number => {
  if ((l.product_type ?? 'term') === 'credit_line') return 0
  if (l.interest_rate == null) return Math.round(Number(l.monthly_interest ?? 0))
  const bal = Math.max(0, Number(l.current_balance ?? 0))
  return Math.round(bal * (Number(l.interest_rate) / 100) / 12)
}
