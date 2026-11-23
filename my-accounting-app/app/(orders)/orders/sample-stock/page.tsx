import { redirect } from 'next/navigation'

// 샘플 재고는 재고 관리의 탭으로 옮겼다 (1400, 2026-11-23) — 옛 주소 호환용 리다이렉트
export default function SampleStockRedirect() {
  redirect('/orders/stock?tab=sample')
}
