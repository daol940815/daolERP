import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildMonthlyPL } from '@/lib/pl-report'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/monthly-pl/export?from=YYYY-MM&to=YYYY-MM
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from'); const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from·to(YYYY-MM)가 필요합니다.' }, { status: 400 })

  const result = await buildMonthlyPL(admin, from, to)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const { months, items } = result.result

  const rows = items.map(it => {
    const row: Record<string, unknown> = { '항목': it.is_section_header ? `[${it.label}]` : it.label }
    months.forEach((m, i) => { row[m] = it.is_section_header ? '' : (it.values[i] ?? 0) })
    return row
  })
  const cols = [28, ...months.map(() => 14)]
  return xlsxResponse(rows, '월별손익현황', cols)
}
