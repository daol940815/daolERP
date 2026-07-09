import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPaymentCandidates } from '@/lib/purchase-payment-match'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/purchase-cycle/payment-candidates?vendorId=...
// 한 거래처의 지급 연결 후보(1:1·분할·합산)를 계산해 내려준다. 추천만 — 확정은 별도 API.
export async function GET(req: NextRequest) {
  const vendorId = new URL(req.url).searchParams.get('vendorId')
  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })

  const admin = createAdminClient()
  const result = await buildPaymentCandidates(admin, vendorId)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const linkedTotal = result.groups.reduce((s, g) => s + g.amount, 0)
  return NextResponse.json({
    ...result,
    summary: {
      unpaid_invoices: result.invoices.length,
      available_txs: result.txs.length,
      groups: result.groups.length,
      coverable_amount: linkedTotal,
    },
  })
}
