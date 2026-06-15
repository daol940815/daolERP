import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildDailyCashRows } from '@/lib/cash-reports'

export const dynamic = 'force-dynamic'

// GET /api/reports/daily-cash?from=&to=&bankAccountId=
// 자금일보: 일별 전일잔액/입금/출금/당일잔액 (전체 계좌 합산 또는 특정 계좌)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from, to 파라미터가 필요합니다.' }, { status: 400 })

  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000
  if (days < 0 || days > 366) return NextResponse.json({ error: '조회 기간은 최대 1년입니다.' }, { status: 400 })

  const result = await buildDailyCashRows(admin, from, to, searchParams.get('bankAccountId'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows })
}
