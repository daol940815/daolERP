import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// 거래처 상세(구) 폐기 (2026-09-29 사용자 결정) — 거래처 유형에 따라 새 허브 상세로 보낸다.
// 매출처(customer)·양쪽(both)은 매출처 허브, 매입처(vendor)는 매입처 관리.
export default async function LegacyVendorDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient()
  const { data } = await admin.from('vendors').select('type').eq('id', params.id).maybeSingle()
  if (!data) redirect('/sales-hub')
  redirect(data.type === 'vendor' ? `/purchase-hub/${params.id}` : `/sales-hub/${params.id}`)
}
