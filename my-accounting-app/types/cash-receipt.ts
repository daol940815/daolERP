export type CashReceiptDirection       = 'sales' | 'purchase'
export type CashReceiptTransactionType = 'approval' | 'cancel'

export interface CashReceipt {
  id: string
  direction: CashReceiptDirection
  tx_date: string
  tx_time: string | null
  transaction_type: CashReceiptTransactionType
  approval_number: string
  counterparty_name: string | null
  counterparty_biz_number: string | null
  issue_type: string | null
  purpose_type: string | null
  deductible: boolean | null
  amount: number
  supply_amount: number
  tax_amount: number
  service_charge: number
  vendor_id: string | null
  note: string | null
  created_at: string
  updated_at: string
  // 425: 매출 발행 건의 통장 입금 확인 상태 + 연결 내역 (목록 API가 매출 탭에서 붙여 준다)
  payment_status?: 'unmatched' | 'partial' | 'matched'
  payments?: CashReceiptPayment[]
}

export interface CashReceiptPayment {
  id: string
  cash_receipt_id?: string
  amount: number
  matched_by: 'auto' | 'manual' | string
  transaction: { id: string; tx_date: string; description: string | null; counterparty_name: string | null; amount_in: number; account_alias: string | null } | null
}
