import { getCurrentUser } from '@/lib/user-role'
import { purchaseHubPerms } from '@/components/purchase-hub/perms'
import PurchaseHubDetailView from '@/components/purchase-hub/purchase-hub-detail'

export const dynamic = 'force-dynamic'

// 매입처 상세 — 다른 영역 링크 노출은 권한으로만 판정한다.
export default async function Page() {
  const me = await getCurrentUser()
  return <PurchaseHubDetailView basePath="/orders/purchase-hub" perms={purchaseHubPerms(me)} />
}
