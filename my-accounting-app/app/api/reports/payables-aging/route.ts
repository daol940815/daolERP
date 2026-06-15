import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPayableAgingRows } from '@/lib/erp-reports'

export const dynamic = 'force-dynamic'

// GET /api/reports/payables-aging?asOf=YYYY-MM-DD
// 미지급금 Aging 분석: 매입처별 미결제 정산금을 정산월 말일 기준 30/60/90/90+일 구간으로 집계
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildPayableAgingRows(admin, searchParams.get('asOf'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows, total: result.total, as_of: result.as_of })
}
