export interface Vendor {
  id: string
  name: string
  biz_number?: string | null
  type: 'vendor' | 'customer' | 'both'
  contact_name?: string | null
  contact_phone?: string | null
  email?: string | null
  note?: string | null
  match_aliases: string[]
  card_numbers: string[]
  ledger_balance?: number | null
  ledger_balance_updated_at?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type TaxInvoiceDirection = 'sales' | 'purchase'
export type TaxInvoiceTaxType   = 'taxable' | 'exempt'
export type TaxInvoicePaymentStatus = 'matched' | 'unmatched'

export interface TaxInvoice {
  id: string
  approval_number: string
  issue_date: string
  issued_date?: string | null
  direction: TaxInvoiceDirection
  tax_type: TaxInvoiceTaxType
  vendor_id?: string | null
  counterparty_name?: string | null
  counterparty_biz_number?: string | null
  supply_amount: number
  tax_amount: number
  total_amount: number
  item_name?: string | null
  note?: string | null
  matched_transaction_id?: string | null
  payment_status: TaxInvoicePaymentStatus
  payment_memo?: string | null
  confirmed_account_id?: string | null
  created_at: string
  updated_at: string
  matched_transaction?: {
    tx_date: string
    amount_in: number
    amount_out: number
    account_alias: string | null
    bank_accounts: { bank_name: string; account_number: string | null; alias: string | null } | null
  } | null
  payments?: TaxInvoicePayment[]
}

export interface TaxInvoicePayment {
  id: string
  amount: number
  transaction_id: string
  created_at: string
  transaction?: {
    tx_date: string
    description: string | null
    counterparty_name: string | null
    amount_in: number
    amount_out: number
    account_alias: string | null
    bank_accounts: { bank_name: string; account_number: string | null; alias: string | null } | null
  } | null
}
