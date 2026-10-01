import { redirect } from 'next/navigation'

// 비밀번호 변경은 내 정보 화면의 '계정' 탭으로 흡수 (2026-10-01) — 옛 주소는 탭으로 보낸다
export default function LegacyMyPasswordPage() {
  redirect('/me/profile?tab=account')
}
