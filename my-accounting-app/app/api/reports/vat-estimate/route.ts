import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVatEstimate } from '@/lib/vat-report'

export const dynamic = 'force-dynamic'

// GET /api/reports/vat-estimate?from=&to=
// 예상 부가세: 세금계산서/현금영수증/카드매출 자료 기준 매출세액-매입세액 추정
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from, to 파라미터가 필요합니다.' }, { status: 400 })

  const result = await buildVatEstimate(admin, from, to)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json(result.result)
}
