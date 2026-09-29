import { redirect } from 'next/navigation'

// 매입처 관리(구) 폐기 (2026-09-29 사용자 결정) — 옛 주소는 매입처 관리(허브)로 보낸다
export default function LegacyVendorsPage() {
  redirect('/purchase-hub')
}
