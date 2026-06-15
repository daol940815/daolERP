import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/bank-accounts — 활성 은행 계좌 목록 (최신 잔액 포함)
export async function GET() {
  const admin = createAdminClient()

  const { data: accounts, error } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number, alias, is_active, account_type, overdraft_limit, created_at, updated_at')
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

      const balance = latestTx?.balance ?? null
      const isOverdraft = account.account_type === 'overdraft'
      const overdraftUsed = isOverdraft ? Math.max(-(balance ?? 0), 0) : 0
      const overdraftAvailable = isOverdraft && account.overdraft_limit != null
        ? Math.max(Math.abs(account.overdraft_limit) - overdraftUsed, 0)
        : 0

      return {
        ...account,
        current_balance: balance,
        balance_date: latestTx?.tx_date ?? null,
        overdraft_used: overdraftUsed,
        overdraft_available: overdraftAvailable,
      }
    })
  )

  return NextResponse.json({ data: accountsWithBalance })
}

// POST /api/bank-accounts — 계좌 직접 등록 (파일 업로드 없이)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json() as { bank_name: string; account_number?: string; alias?: string }

  if (!body.bank_name?.trim()) {
    return NextResponse.json({ error: '은행명은 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('bank_accounts')
    .insert({
      bank_name:      body.bank_name.trim(),
      account_number: body.account_number?.trim() || null,
      alias:          body.alias?.trim()          || null,
    })
    .select('id, bank_name, account_number, alias, is_active, created_at, updated_at')
    .single()

  if (error) {
    const isDuplicate = error.code === '23505'
    return NextResponse.json(
      { error: isDuplicate ? '동일한 은행명+계좌번호가 이미 존재합니다.' : error.message },
      { status: isDuplicate ? 409 : 500 },
    )
  }

  // 등록된 은행명과 account_alias가 일치하는 미연결 거래 자동 연결
  // (파일 업로드 시 bank_account_id 없이 account_alias만 저장된 거래들)
  const { data: linked } = await admin
    .from('transactions')
    .update({ bank_account_id: data.id })
    .eq('account_alias', body.bank_name.trim())
    .is('bank_account_id', null)
    .select('id')

  return NextResponse.json({ data, linkedTransactions: linked?.length ?? 0 })
}

