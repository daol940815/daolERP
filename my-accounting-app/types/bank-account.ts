export interface BankAccount {
  id: string
  bank_name: string
  account_number: string | null
  alias: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}
