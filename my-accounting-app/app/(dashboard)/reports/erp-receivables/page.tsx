import { redirect } from 'next/navigation'

// 수금 대상(매출처별 미수 합계표)은 결제 확인 화면의 '결제 안내 대상' 탭(주문 단위 작업 목록)으로 통합 (2026-11-16)
// 매출처별 합계는 회계 › 미수금 관리, 매출처 관리에서 본다.
export default function LegacyErpReceivablesPage() {
  redirect('/payments?tab=guide')
}
