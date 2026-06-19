import type { ErpCollectStatus } from './erp'

// 매출처 상세 페이지 — 주문내역 한 행 (순매출/순미수금은 취소·VIP·선결제 제외 + 매칭 수금 차감 반영)
export interface VendorOrderRow {
  id: string
  order_no: string
  order_date: string
  staff_name: string | null
  manager_name: string | null
  total_amount: number
  outstanding_amount: number
  collect_status: ErpCollectStatus
  item_count: number
}

// 매출처 상세 페이지 — 선호 품목(수량 기준 상위) 한 행
export interface VendorPreferredItemRow {
  item_name: string
  order_count: number
  quantity: number
  line_total: number
}

// 매출처 상세 페이지 — 주문내역/선호품목/매출·미수금 집계
export interface VendorSalesDetail {
  alias_ids: string[]
  staff_names: string[]
  orders: VendorOrderRow[]
  preferred_items: VendorPreferredItemRow[]
  cum_sales: number
  cum_outstanding: number
  month_sales: number
}

// 매출처 목록 페이지 한 행
export interface VendorSalesListRow {
  vendor_id: string | null      // null이면 vendor에 연결되지 않은 alias
  alias_ids: string[]
  name: string                  // 거래처명(또는 미연결 alias의 erp_name)
  linked: boolean                // vendor_id 존재 여부
  outstanding_amount: number    // 미수금 (ERP 기준, 매칭 수금 차감)
  cum_sales: number
  month_sales: number
  staff_names: string[]         // 담당직원(다올직원) 목록
}
