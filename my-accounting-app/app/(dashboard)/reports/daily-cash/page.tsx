import { redirect } from 'next/navigation'

// 자금일보는 자금 · 계좌 화면의 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다
export default function LegacyDailyCashPage() {
  redirect('/reports/cash?tab=daily')
}
