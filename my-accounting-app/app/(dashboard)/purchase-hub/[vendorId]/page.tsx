import PurchaseHubDetailView from '@/components/purchase-hub/purchase-hub-detail'

// 매입처 상세 — 회계·경영 모드
export default function PurchaseHubDetailPage() {
  return <PurchaseHubDetailView basePath="/purchase-hub" canDrilldown />
}
