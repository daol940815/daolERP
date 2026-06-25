import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildReceivableAgingRows } from '@/lib/erp-reports'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/receivables-aging?asOf=YYYY-MM-DD
// 미수금 Aging 분석: 매출처별 미수금을 발생일(주문일) 기준 30/60/90/90+일 구간으로 집계
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildReceivableAgingRows(admin, searchParams.get('asOf'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.rows, total: result.total, as_of: result.as_of })
}
