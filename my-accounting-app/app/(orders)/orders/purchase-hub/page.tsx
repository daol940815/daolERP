import { getCurrentUser } from '@/lib/user-role'
import { purchaseHubPerms } from '@/components/purchase-hub/perms'
import PurchaseHubShell from '@/components/purchase-hub/purchase-hub-shell'

export const dynamic = 'force-dynamic'

// 매입처 관리 — 매입처 목록 / 결제 예외 탭 (2026-09-30 통합 7). 다른 영역 링크 노출은 권한으로만 판정한다(경로 소속과 무관).
export default async function Page({ searchParams }: { searchParams: { tab?: string; vendor?: string } }) {
  const me = await getCurrentUser()
  return <PurchaseHubShell basePath="/orders/purchase-hub" perms={purchaseHubPerms(me)} tab={searchParams.tab} vendorId={searchParams.vendor} />
}
