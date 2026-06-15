import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVendorAnalysisRows } from '@/lib/vendor-analysis'

export const dynamic = 'force-dynamic'

// GET /api/reports/vendor-profitability?from=&to=
// 거래처별 수익성 분석: 매출처(고객 alias)별 기간 내 매출/매입원가/매출이익/이익률
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildVendorAnalysisRows(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows })
}
