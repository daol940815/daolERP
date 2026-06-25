import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildErpSpecialData } from '@/lib/erp-special'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/erp-special?from=&to=
// VIP 품목 내역 + 매출처 선결제 원장/잔액 (자료출력용)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildErpSpecialData(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json(result)
}
