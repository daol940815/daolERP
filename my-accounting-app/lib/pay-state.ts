// 주문의 결제 상태 — 한 칸 표기 (2026-11-13 사용자 확정, 시안 docs/mockups/주문내역_결제상태_시안.html)
//   수단 꼬리표(카드 · 이체 · 계산서 · 선결제 · 혼합) + 단계 5개. 단계는 "지금 누구 차례인가" 기준.
//   1차(결제 기록) = 매칭 대기 기록 합 + 이미 매칭된 금액(기록 없이 붙인 입금 · 선결제 사용 포함)
//   2차(매칭)     = 실제 입금 · 카드 매출과 매칭된 금액 = 순매출 − 표준 미수
//   미수금 숫자는 매칭 기준 그대로(기록만으로는 줄지 않는다).
// 화면 · 엑셀 · 서버가 함께 쓰므로 서버 전용 import를 넣지 말 것.

export type PayStage = 'unpaid' | 'partial_pay' | 'match_wait' | 'partial_match' | 'done' | 'canceled'
export type PayMethodTag = 'card' | 'transfer' | 'invoice' | 'prepay' | 'mixed'

export const PAY_STAGE_LABEL: Record<PayStage, string> = {
  unpaid: '미결제', partial_pay: '일부 결제', match_wait: '매칭 대기', partial_match: '일부 매칭', done: '완료', canceled: '취소',
}
export const PAY_STAGE_CLS: Record<PayStage, string> = {
  unpaid: 'bg-red-100 text-red-700', partial_pay: 'bg-orange-100 text-orange-700', match_wait: 'bg-amber-100 text-amber-800',
  partial_match: 'bg-blue-100 text-blue-700', done: 'bg-emerald-100 text-emerald-700', canceled: 'bg-gray-100 text-gray-500',
}
// 누구 차례인지 (배지 설명)
export const PAY_STAGE_HINT: Record<PayStage, string> = {
  unpaid: '결제 기록도 매칭도 없음 — 결제 안내 필요',
  partial_pay: '주문 금액 중 일부만 결제 기록됨 — 나머지 결제 안내 필요',
  match_wait: '전액 기록됨 — 실제 입금 · 카드 매출과 매칭 대기',
  partial_match: '전액 기록됨, 일부만 매칭됨 — 나머지 매칭 대기',
  done: '주문 금액 전액 매칭됨',
  canceled: '취소된 주문',
}
export const PAY_METHOD_TAG_LABEL: Record<PayMethodTag, string> = { card: '카드', transfer: '이체', invoice: '계산서', prepay: '선결제', mixed: '혼합' }
export const PAY_METHOD_TAG_CLS: Record<PayMethodTag, string> = {
  card: 'text-violet-700 border-violet-200', transfer: 'text-blue-700 border-blue-200', invoice: 'text-indigo-700 border-indigo-200',
  prepay: 'text-fuchsia-700 border-fuchsia-200', mixed: 'text-slate-600 border-slate-300',
}
// 목록 칩 순서
export const PAY_STAGE_CHIPS: PayStage[] = ['unpaid', 'partial_pay', 'match_wait', 'partial_match', 'done']

export interface PayState {
  stage: PayStage
  method: PayMethodTag | null   // 미결제 · 완료 · 취소에도 값은 들어 있다(엑셀용). 화면 꼬리표는 진행 단계에만 붙인다
  recorded: number              // 1차: 매칭 대기 기록 + 매칭된 금액
  matched: number               // 2차: 매칭된 금액
}

export function payStageOf(i: { canceled: boolean; net: number; outstanding: number; pending: number }): { stage: PayStage; recorded: number; matched: number } {
  if (i.canceled) return { stage: 'canceled', recorded: 0, matched: 0 }
  const matched = Math.max(0, i.net - i.outstanding)
  const recorded = matched + Math.max(0, i.pending)
  if (i.outstanding <= 0) return { stage: 'done', recorded, matched }
  if (recorded <= 0) return { stage: 'unpaid', recorded, matched }
  if (recorded < i.net) return { stage: 'partial_pay', recorded, matched }
  return { stage: matched <= 0 ? 'match_wait' : 'partial_match', recorded, matched }
}

export const methodTagOf = (methods: Iterable<string>): PayMethodTag | null => {
  const set = new Set(methods)
  if (set.size === 0) return null
  if (set.size > 1) return 'mixed'
  return Array.from(set)[0] as PayMethodTag
}
// 꼬리표는 진행 중인 단계에만 (미결제 · 완료 · 취소는 배지만)
export const showMethodTag = (stage: PayStage) => stage === 'partial_pay' || stage === 'match_wait' || stage === 'partial_match'
