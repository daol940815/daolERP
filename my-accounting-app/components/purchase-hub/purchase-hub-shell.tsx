import PageTabs from '@/components/ui/PageTabs'
import PurchaseHubList from './purchase-hub-list'
import ExceptionsTab from '@/app/(dashboard)/purchase-cycle/exceptions-tab'
import type { PurchaseHubPerms } from './perms'

// 매입처 관리 셸 — 매입처 목록 / 결제 예외 탭 (2026-09-30 통합 7).
// 세 영역(/orders/purchase-hub · /purchase-hub)이 같은 셸을 쓴다. 결제 예외 탭은 수금·정산 조회 권한자에게만
// 보인다(사용자 확정: 권한은 collections 유지). 옛 /purchase-cycle 은 영업·주문의 결제 예외 탭으로 리다이렉트.
export default function PurchaseHubShell({ basePath, perms, tab, vendorId }: {
  basePath: string
  perms: PurchaseHubPerms
  tab?: string
  vendorId?: string
}) {
  const active = tab === 'exceptions' && perms.collections ? 'exceptions' : 'list'
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">매입처 관리</h1>
      {perms.collections && (
        <PageTabs className="mt-3 mb-3" active={active} tabs={[
          { key: 'list', label: '매입처 목록', href: basePath },
          { key: 'exceptions', label: '결제 예외', href: `${basePath}?tab=exceptions` },
        ]} />
      )}
      {active === 'exceptions'
        ? <ExceptionsTab basePath={basePath} vendorId={vendorId} canEdit={perms.collectionsEdit} />
        : <PurchaseHubList basePath={basePath} perms={perms} />}
    </div>
  )
}
