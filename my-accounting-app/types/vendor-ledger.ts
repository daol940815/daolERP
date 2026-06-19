export type VendorLedgerEntryType = 'opening' | 'payment' | 'adjustment'

export interface VendorLedgerEntry {
  id: string
  vendor_id: string
  entry_type: VendorLedgerEntryType
  entry_date: string
  amount: number
  memo: string | null
  transaction_id: string | null
  created_at: string
}

// 매입처 상세 페이지 — 정산 요약 (기초잔액/당월계산서/당월입금/현재잔액)
export interface VendorLedgerSummary {
  opening_balance: number
  month_invoice: number
  month_payment: number
  current_balance: number
}

// 매입처 상세 페이지 — 월별 정산현황 한 행
export interface VendorMonthlyLedgerRow {
  month: string          // 'YYYY-MM'
  purchase_amount: number  // ERP 매입금액 (settlement_month 기준)
  invoice_amount: number   // 세금계산서 공급가액+세액 합 (issue_date 작성일자 기준)
  invoice_carried_over: boolean  // 해당 월 계산서 중 발급일자 월이 작성일자 월과 다른 건이 있는지
  payment_amount: number    // 입금
  adjustment_amount: number // 조정 (+/-)
  balance: number           // 월말 기준 누적 잔액
}

// 매입처 목록 페이지 한 행
export interface VendorPurchaseListRow {
  vendor_id: string | null      // null이면 vendor에 연결되지 않은 alias
  alias_ids: string[]
  name: string                  // 거래처명(또는 미연결 alias의 erp_name)
  linked: boolean                // vendor_id 존재 여부 (정산/잔액 기능 사용 가능 여부)
  unpaid_balance: number | null  // 미지급액(현재잔액) — linked=false면 null
  cum_sales: number
  cum_purchase: number
  cum_profit: number
  month_sales: number
  month_purchase: number
  month_profit: number
}
