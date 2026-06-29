import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildDailyCashRows } from '@/lib/cash-reports'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/daily-cash/export?from=&to=&bankAccountId=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from'); const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from·to가 필요합니다.' }, { status: 400 })

  const result = await buildDailyCashRows(admin, from, to, searchParams.get('bankAccountId'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const rows = result.rows.map(r => ({
    '일자': r.date, '전일순현금': r.opening_balance, '입금': r.deposit, '출금': r.withdrawal,
    '당일순현금': r.closing_balance, '보유현금': r.held_cash, '마통사용액': r.overdraft_used,
  }))
  return xlsxResponse(rows, '자금일보', [12, 16, 14, 14, 16, 16, 14])
}
