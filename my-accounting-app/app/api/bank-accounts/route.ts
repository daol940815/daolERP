import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

// GET /api/bank-accounts — 활성 은행 계좌 목록
export async function GET() {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('bank_accounts')
    .select('id, bank_name, account_number, alias, is_active')
    .eq('is_active', true)
    .order('bank_name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}
