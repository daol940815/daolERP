import { getCurrentUser } from '@/lib/user-role'
import PurchaseHubDetailView from '@/components/purchase-hub/purchase-hub-detail'

export const dynamic = 'force-dynamic'

// 매입처 상세 — 주문 관리 모드
export default async function OrdersPurchaseHubDetailPage() {
  const me = await getCurrentUser()
  return <PurchaseHubDetailView basePath="/orders/purchase-hub" canDrilldown={me?.role === 'admin'} />
}
