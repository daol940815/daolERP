export type ErpAliasType     = 'customer' | 'purchase'
export type ErpPaymentTerm   = 'advance' | 'monthly'
export type ErpCollectStatus = 'collected' | 'outstanding' | 'in_progress'

export interface ErpVendorAlias {
  id: string
  alias_type: ErpAliasType
  erp_name: string
  vendor_id: string | null
  payment_term: ErpPaymentTerm
  created_at: string
  updated_at: string
}

export interface ErpOrder {
  id: string
  order_no: string
  order_date: string
  bank_name: string | null
  branch_name: string | null
  customer_alias_id: string | null
  manager_name: string | null
  staff_name: string | null
  contact: string | null
  phone: string | null
  introducer: string | null
  supervisor: string | null
  supervisor_contact: string | null
  total_amount: number
  outstanding_amount: number
  collect_status: ErpCollectStatus
  memo: string | null
  etc: string | null
  created_at: string
  updated_at: string
}

export interface ErpOrderItem {
  id: string
  order_id: string
  line_no: number
  is_canceled: boolean
  is_vip: boolean
  is_prepayment: boolean
  item_code: string | null
  item_name: string | null
  order_kind: string | null
  purchase_vendor_name: string | null
  purchase_alias_id: string | null
  sale_price: number
  quantity: number
  shipping_fee: number
  discount_amount: number
  line_total: number
  line_outstanding: number
  purchase_price: number
  purchase_shipping: number
  purchase_total: number
  settlement_month: string | null
  channel: string | null
  memo: string | null
  created_at: string
  updated_at: string
}

export interface ErpPurchaseSettlement {
  id: string
  purchase_alias_id: string
  settlement_month: string
  status: 'unpaid' | 'paid'
  paid_date: string | null
  paid_amount: number | null
  memo: string | null
  created_at: string
  updated_at: string
}

export interface ErpPrepayment {
  id: string
  direction: ErpAliasType
  alias_id: string
  entry_date: string
  entry_type: 'deposit' | 'deduction'
  amount: number
  order_id: string | null
  settlement_id: string | null
  source_key: string | null
  memo: string | null
  created_at: string
  updated_at: string
}

// ── 리포트 집계 행 ──────────────────────────────────────

export interface ErpReceivableRow {
  alias_id: string | null
  erp_name: string             // 은행 + 지점명
  vendor_id: string | null
  vendor_name: string | null   // 연결된 거래처명
  order_count: number
  total_amount: number         // VIP/선결제/취소 제외 순매출
  excluded_amount: number      // VIP/선결제 금액 (참고)
  outstanding_amount: number   // ERP 미수금 합
  outstanding_count: number    // 미수 주문 건수
  prepay_balance: number       // 선결제 잔액
  staff_names: string[]        // 담당직원(다올직원) 목록
}

export interface ErpPayableRow {
  alias_id: string
  erp_name: string
  vendor_id: string | null
  vendor_name: string | null
  payment_term: ErpPaymentTerm
  settlement_month: string
  item_count: number
  purchase_total: number       // 매입액 합 (취소/VIP/선결제 제외)
  settlement_id: string | null
  status: 'unpaid' | 'paid'
  paid_date: string | null
  paid_amount: number | null
  settlement_memo: string | null
  prepay_balance: number       // 매입처 선입금 잔액
}
