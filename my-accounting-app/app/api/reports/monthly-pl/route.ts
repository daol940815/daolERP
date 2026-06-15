import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildMonthlyPL } from '@/lib/pl-report'

export const dynamic = 'force-dynamic'

// GET /api/reports/monthly-pl?from=YYYY-MM&to=YYYY-MM
// 월별 손익현황(경영관리용): ERP 매출/매출원가 + 은행거래 비용분류 기준 운영비를 월별로 집계
// (법인카드 매입/급여/감가상각비는 데이터 미보유로 "미반영" 항목으로 표시)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from, to 파라미터가 필요합니다. (YYYY-MM)' }, { status: 400 })
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'from, to는 YYYY-MM 형식이어야 합니다.' }, { status: 400 })
  }

  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12
    + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1
  if (months < 1 || months > 36) return NextResponse.json({ error: '조회 기간은 최대 36개월입니다.' }, { status: 400 })

  const result = await buildMonthlyPL(admin, from, to)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json(result.result)
}
