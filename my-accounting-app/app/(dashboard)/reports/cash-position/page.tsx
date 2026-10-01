import { redirect } from 'next/navigation'

// 계좌 통합현황은 자금 · 계좌 화면의 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다
export default function LegacyCashPositionPage() {
  redirect('/reports/cash')
}
