import PurchaseHubList from '@/components/purchase-hub/purchase-hub-list'

// 매입처 관리 — 회계·경영 모드 (admin 전용 레이아웃이라 드릴다운 전면 허용)
export default function PurchaseHubPage() {
  return <PurchaseHubList basePath="/purchase-hub" canDrilldown />
}
