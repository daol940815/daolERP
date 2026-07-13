import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCashPositionRows } from '@/lib/cash-reports'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/cash-position/export?from=&to=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const result = await buildCashPositionRows(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const rows = result.rows.map(r => ({
    '은행': r.bank_name, '계좌번호': r.account_number ?? '', '별칭': r.alias ?? '',
    '계좌유형': r.account_type === 'overdraft' ? '마이너스' : '일반',
    '잔액': r.balance, '잔액일자': r.balance_date ?? '',
    '기간입금': r.period_in, '기간출금': r.period_out,
    '마통사용액': r.overdraft_used, '마통미사용한도': r.overdraft_available,
  }))
  return xlsxResponse(rows, '계좌통합현황', [12, 18, 16, 10, 16, 12, 14, 14, 16, 16])
}
