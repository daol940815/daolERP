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
}
