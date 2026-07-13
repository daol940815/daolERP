import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVendorMonthlyLedger } from '@/lib/vendor-ledger'

export const dynamic = 'force-dynamic'

// GET /api/vendors/:id/ledger-summary
// 매입처 상세 페이지의 "정산 요약"(기초잔액/당월계산서/당월입금/현재잔액) + "월별 정산현황" 데이터
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const result = await buildVendorMonthlyLedger(admin, id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json(result)
}
