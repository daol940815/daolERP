import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVendorSalesDetail } from '@/lib/vendor-sales-detail'

export const dynamic = 'force-dynamic'

// GET /api/vendors/:id/sales-detail
// 매출처 상세 페이지의 "주문내역" / "선호 품목" / 매출액·미수금(ERP 기준) 데이터
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const currentMonth = new Date().toISOString().slice(0, 7)
  const result = await buildVendorSalesDetail(admin, id, currentMonth)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.data })
}
