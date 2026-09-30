import { redirect } from 'next/navigation'

// 통장 거래 분류는 통장 내역 화면의 '분류 작업' 탭으로 통합 (2026-09-30) — 옛 주소는 탭으로 보낸다
export default function LegacyBankClassifyPage() {
  redirect('/transactions?tab=classify')
}
