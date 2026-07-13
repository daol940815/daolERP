import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/ledger/account
//   ?accountId 미지정          → 분개에 등장한 계정 목록(선택용)
//   ?accountId=&from=&to=      → 해당 계정 원장(전월이월·라인·월계·누계)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('accountId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!accountId) {
    const { data, error } = await admin.rpc('accounts_with_journal')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ accounts: data ?? [] })
  }

  if (!from || !to) {
    return NextResponse.json({ error: '조회 기간(from·to)이 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await admin.rpc('account_ledger', {
    p_account_id: accountId,
    p_from: from,
    p_to: to,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (data && (data as { error?: string }).error) {
    return NextResponse.json({ error: (data as { error: string }).error }, { status: 404 })
  }
  return NextResponse.json(data)
}
