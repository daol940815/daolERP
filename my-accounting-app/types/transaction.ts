export interface Transaction {
  id: string
  tx_date: string
  description: string
  amount_in: number
  amount_out: number
  balance?: number | null
  source: 'bank' | 'card' | 'manual'
  account_alias?: string | null
  status: 'pending' | 'reviewed' | 'confirmed'
  memo?: string | null
  is_journalized: boolean
  suggested_account_id?: string | null
  confirmed_account_id?: string | null
  ai_confidence?: number | null
  ai_reason?: string | null
  upload_log_id?: string | null
  created_at: string
}

export interface Account {
  id: string
  name: string
  code?: string | null
  type: string
  keywords?: string[] | null
  is_active: boolean
}
