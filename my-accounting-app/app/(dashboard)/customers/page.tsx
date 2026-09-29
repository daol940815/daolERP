import { redirect } from 'next/navigation'

// 매출처 관리(구) 폐기 (2026-09-29 사용자 결정) — 옛 주소는 매출처 허브로 보낸다
export default function LegacyCustomersPage() {
  redirect('/sales-hub')
}
