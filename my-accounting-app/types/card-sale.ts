export type CardSaleTransactionType = 'approval' | 'cancel'

export interface CardSale {
  id: string
  order_match_count?: number    // 주문 매칭 건수 (승인 행, 2026-11-04)
  order_match_amount?: number
  cancel_amount?: number        // 같은 승인번호 취소 합 (승인 행) — 순액 = amount − cancel_amount
  tx_date: string
  tx_time?: string | null
  transaction_type: CardSaleTransactionType
  approval_number: string
  card_number?: string | null
  acquirer?: string | null
  amount: number
  supply_amount: number
  tax_amount: number
  processing_status?: string | null
  deposit_expected_date?: string | null
  cancelled_at?: string | null
  settlement_status?: string | null
  vendor_id?: string | null
  note?: string | null
  created_at: string
  updated_at: string
}
