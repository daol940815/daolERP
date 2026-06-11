import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/erp-items?aliasId=&month=YYYY-MM
// 매입처 × 정산월 그룹의 품목 목록 (결제현황 화면 펼침용)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const aliasId = searchParams.get('aliasId')
  const month   = searchParams.get('month')
  if (!aliasId || !month) {
    return NextResponse.json({ error: 'aliasId와 month가 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('erp_order_items')
    .select('*')
    .eq('purchase_alias_id', aliasId)
    .eq('settlement_month', month)
    .eq('is_canceled', false)
    .eq('is_vip', false)
    .eq('is_prepayment', false)
    .order('created_at')
    .limit(2000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}
