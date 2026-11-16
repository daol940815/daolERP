import { redirect } from 'next/navigation'

// 계산서 발행 대상(매출 사이클 현황판)은 결제 확인 화면의 '계산서 확인' 탭으로 통합 (2026-11-16)
// 매출처별 현황판은 없앴다 — 같은 숫자는 매출처 관리 · 미수금 관리에 있다. 계산서 연결 · 수금후보 창(이 폴더의 모달)은 그대로 쓴다.
export default function LegacySalesCyclePage() {
  redirect('/payments?tab=invoice')
}
