import { redirect } from 'next/navigation'

// 매입 사이클 예외 관리는 매입처 관리 화면의 '결제 예외' 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다
export default function LegacyPurchaseCyclePage() {
  redirect('/orders/purchase-hub?tab=exceptions')
}
