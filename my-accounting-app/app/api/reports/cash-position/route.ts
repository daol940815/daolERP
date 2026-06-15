import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCashPositionRows } from '@/lib/cash-reports'

export const dynamic = 'force-dynamic'

// GET /api/reports/cash-position?from=&to=
// 법인계좌 통합현황: 계좌별 최신잔액 + 총잔액 + 기간 내 입출금 합계
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildCashPositionRows(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows, total: result.total, summary: result.summary })
}
