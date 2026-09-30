import { redirect } from 'next/navigation'

// 법인카드 사용내역은 카드 내역 화면의 '법인카드' 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다
export default function LegacyCardExpensesPage({ searchParams }: { searchParams: { cardAccountId?: string } }) {
  const p = new URLSearchParams({ tab: 'expenses' })
  if (searchParams.cardAccountId) p.set('cardAccountId', searchParams.cardAccountId)
  redirect(`/cards?${p}`)
}
