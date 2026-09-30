import { redirect } from 'next/navigation'

// 카드매출은 카드 내역 화면의 '매출' 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다 (?q= 드릴다운 유지)
export default function LegacyCardSalesPage({ searchParams }: { searchParams: { q?: string } }) {
  const p = new URLSearchParams()
  if (searchParams.q) p.set('q', searchParams.q)
  redirect(p.size ? `/cards?${p}` : '/cards')
}
