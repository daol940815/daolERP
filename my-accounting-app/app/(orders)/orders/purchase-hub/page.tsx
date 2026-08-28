import { getCurrentUser } from '@/lib/user-role'
import PurchaseHubList from '@/components/purchase-hub/purchase-hub-list'

export const dynamic = 'force-dynamic'

// 매입처 관리 — 주문 관리 모드 (2026-08-14 사용자 결정: 직원에게 전체 공개)
// 회계·경영 모드 화면으로 나가는 드릴다운은 admin만 — 다른 역할은 그 화면에
// 접근하면 워크스페이스로 되돌려지므로 링크를 감춘다.
export default async function OrdersPurchaseHubPage() {
  const me = await getCurrentUser()
  return <PurchaseHubList basePath="/orders/purchase-hub" canDrilldown={me?.role === 'admin'} />
}
