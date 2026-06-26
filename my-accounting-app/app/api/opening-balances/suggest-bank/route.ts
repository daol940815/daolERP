import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/opening-balances/suggest-bank
// 은행 거래후잔액(현재잔액 - 총net)으로 보통예금·단기차입금 기초잔액 "추정값"을 제안한다(읽기전용, 저장 안 함).
// ※ 거래 순서 정보(tx_time) 부재로 부정확할 수 있어, 사용자가 검토 후 수기 확정한다.
export async function GET() {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('suggest_bank_opening_balances')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ suggestions: data ?? [] })
}
