import { redirect } from 'next/navigation'

// 매입처/매출처를 나누어 관리하므로, 기준 경로 접근 시 매입처 관리로 안내한다.
export default function VendorsIndexPage() {
  redirect('/vendors/suppliers')
}
