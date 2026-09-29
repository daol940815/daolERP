import { getCurrentUser } from '@/lib/user-role'
import { purchaseHubPerms } from '@/components/purchase-hub/perms'
import PurchaseHubList from '@/components/purchase-hub/purchase-hub-list'

export const dynamic = 'force-dynamic'

// 매입처 관리 — 목록. 다른 영역 링크 노출은 권한으로만 판정한다(경로 소속과 무관).
export default async function Page() {
  const me = await getCurrentUser()
  return <PurchaseHubList basePath="/orders/purchase-hub" perms={purchaseHubPerms(me)} />
}
