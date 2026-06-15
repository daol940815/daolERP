export interface BankAccount {
  id: string
  bank_name: string
  account_number: string | null
  alias: string | null
  is_active: boolean
  account_type: 'normal' | 'overdraft'
  overdraft_limit: number | null     // 한도 (음수, 예: -200000000)
  current_balance: number | null
  balance_date: string | null
  overdraft_used: number | null      // 마이너스통장 현재 사용액 (일반계좌는 0)
  overdraft_available: number | null // 마이너스통장 미사용 한도 (일반계좌는 0)
  created_at: string
  updated_at: string
}
