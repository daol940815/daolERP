export interface BankAccount {
  id: string
  bank_name: string
  account_number: string | null
  alias: string | null
  is_active: boolean
  current_balance: number | null
  balance_date: string | null
  created_at: string
  updated_at: string
}
