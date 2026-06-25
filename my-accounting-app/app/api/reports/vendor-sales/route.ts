import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVendorAnalysisRows } from '@/lib/vendor-analysis'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/vendor-sales?from=&to=
// 거래처별 매출 분석: 매출처(고객 alias)별 기간 내 순매출/주문건수/수량
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildVendorAnalysisRows(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows })
}
