import { redirect } from 'next/navigation'

// 거래처별 기초잔액은 기초잔액 화면의 '거래처' 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다
export default function LegacyVendorOpeningBalancesPage({ searchParams }: { searchParams: { q?: string } }) {
  const p = new URLSearchParams({ tab: 'vendor' })
  if (searchParams.q) p.set('q', searchParams.q)
  redirect(`/opening-balances?${p}`)
}
