export type InstitutionType = 'bank' | 'card'

export interface Institution {
  id: number
  name: string
  type: InstitutionType
  code: string | null
  created_at: string | null
}

export interface Account {
  id: number
  institution_id: number
  account_number: string | null
  account_name: string | null
  account_type: string | null
  currency: string
  is_active: boolean
  created_at: string | null
  institution: Institution | null
}

export type TransactionType = 'deposit' | 'withdrawal' | 'card_purchase' | 'card_cancel'

export interface Transaction {
  id: number
  account_id: number
  transaction_date: string
  transaction_time: string | null
  description: string | null
  counterparty: string | null
  amount: number
  balance: number | null
  transaction_type: TransactionType | null
  category: string | null
  memo: string | null
  hash_key: string | null
  is_duplicate: boolean
  created_at: string | null
  account: Account | null
}

export interface TransactionLog {
  id: number
  transaction_id: number
  field_name: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
}

export interface UploadHistory {
  id: number
  institution_id: number | null
  account_id: number | null
  filename: string
  file_size: number | null
  total_rows: number
  success_rows: number
  duplicate_rows: number
  error_rows: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  uploaded_at: string
  completed_at: string | null
  institution: Institution | null
}

export interface UploadResult {
  upload_id: number
  filename: string
  total_rows: number
  success_rows: number
  duplicate_rows: number
  error_rows: number
  status: string
  errors: string[]
}

export interface DashboardStats {
  total_transactions: number
  total_deposit: number
  total_withdrawal: number
  net_amount: number
  institution_count: number
  account_count: number
  recent_upload_count: number
}

export interface MonthlySummary {
  month: number
  deposit: number
  withdrawal: number
  count: number
}

export interface InstitutionSummary {
  name: string
  type: InstitutionType
  count: number
  deposit: number
  withdrawal: number
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
  pages: number
}

export interface TransactionFilter {
  institution_id?: number
  account_id?: number
  transaction_type?: string
  category?: string
  date_from?: string
  date_to?: string
  amount_min?: number
  amount_max?: number
  keyword?: string
  page?: number
  size?: number
}
