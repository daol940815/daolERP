import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/ledger/vendor
//   ?vendorId 미지정          → 거래처별 잔액 요약(잔액 탭)
//   ?vendorId=&from=&to=      → 해당 거래처 상세 원장(내용 탭)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const vendorId = searchParams.get('vendorId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: '조회 기간(from·to)이 필요합니다.' }, { status: 400 })
  }

  if (!vendorId) {
    const { data, error } = await admin.rpc('vendor_ledger_balances', { p_from: from, p_to: to })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ balances: data ?? [] })
  }

  const { data, error } = await admin.rpc('vendor_ledger_detail', {
    p_vendor_id: vendorId,
    p_from: from,
    p_to: to,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (data && (data as { error?: string }).error) {
    return NextResponse.json({ error: (data as { error: string }).error }, { status: 404 })
  }
  return NextResponse.json(data)
}
