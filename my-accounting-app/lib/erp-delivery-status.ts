import type { ErpOrderItem, ErpOrderDeliveryStatus } from '@/types/erp'

export const ITEM_DELIVERY_STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  in_transit: { text: '이동중',   cls: 'bg-blue-50 text-blue-600' },
  delivered:  { text: '배송완료', cls: 'bg-green-50 text-green-700' },
  issue:      { text: '확인필요', cls: 'bg-red-50 text-red-600' },
}

export const ORDER_DELIVERY_STATUS_LABEL: Record<ErpOrderDeliveryStatus, { text: string; cls: string }> = {
  invoice_needed: { text: '송장기입', cls: 'bg-gray-100 text-gray-500' },
  in_progress:    { text: '진행중',   cls: 'bg-amber-50 text-amber-700' },
  issue:          { text: '확인필요', cls: 'bg-red-50 text-red-600' },
  delivered:      { text: '배송완료', cls: 'bg-green-50 text-green-700' },
}

// 주문의 품목별 송장번호/배송상태를 집계해 주문 단위 배송상태를 계산한다.
// - 예외품목(배송비, 포장 등)·취소품목은 집계에서 제외
// - 집계 대상 품목이 없으면 null (배송상태 표시 안 함)
// - 송장번호 입력된 품목 중 이동 확인이 안 되는(delivery_status 미입력) 품목이 있으면 확인필요
// - 송장번호가 하나도 입력되지 않았으면 송장기입
// - 모두 배송완료면 배송완료, 그 외(일부 완료/이동중)는 진행중
export function computeOrderDeliveryStatus(items: ErpOrderItem[]): ErpOrderDeliveryStatus | null {
  const relevant = items.filter(it => !it.is_shipping_exempt && !it.is_canceled)
  if (!relevant.length) return null

  const withTracking = relevant.filter(it => it.tracking_number)
  if (!withTracking.length) return 'invoice_needed'

  if (withTracking.some(it => !it.delivery_status || it.delivery_status === 'issue')) return 'issue'
  if (withTracking.every(it => it.delivery_status === 'delivered') && withTracking.length === relevant.length) return 'delivered'
  return 'in_progress'
}
