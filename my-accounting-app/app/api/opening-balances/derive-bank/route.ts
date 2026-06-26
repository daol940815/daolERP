import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/opening-balances/derive-bank
// 은행 거래후잔액(transactions.balance) 역산으로 보통예금·단기차입금 기초잔액을 자동 계산(멱등).
export async function POST() {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('derive_bank_opening_balances')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ derived: data ?? [] })
}
