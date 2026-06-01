import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

// GET /api/bank-accounts — 활성 은행 계좌 목록 (최신 잔액 포함)
export async function GET() {
  const admin = createAdminClient()

  const { data: accounts, error } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number, alias, is_active, created_at, updated_at')
    .eq('is_active', true)
    .order('bank_name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 각 계좌의 최신 잔액 조회 (balance 값이 있는 가장 최근 거래)
  const accountsWithBalance = await Promise.all(
    (accounts ?? []).map(async (account) => {
      const { data: latestTx } = await admin
        .from('transactions')
        .select('balance, tx_date')
        .eq('bank_account_id', account.id)
        .not('balance', 'is', null)
        .order('tx_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      return {
        ...account,
        current_balance: latestTx?.balance ?? null,
        balance_date: latestTx?.tx_date ?? null,
      }
    })
  )

  return NextResponse.json({ data: accountsWithBalance })
}
