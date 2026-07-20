import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCollectionCandidates } from '@/lib/sales-collection-match'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/sales-cycle/collection-candidates?vendorId=...
// 한 매출처의 수금 연결 후보(1:1·분할·합산)를 계산해 내려준다. 추천만 — 확정은 POST.
export async function GET(req: NextRequest) {
  const vendorId = new URL(req.url).searchParams.get('vendorId')
  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })

  const admin = createAdminClient()
  const result = await buildCollectionCandidates(admin, vendorId)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({
    ...result,
    summary: {
      open_orders: result.orders.length,
      available_deposits: result.deposits.length,
      groups: result.groups.length,
      coverable_amount: result.groups.reduce((s, g) => s + g.amount, 0),
    },
  })
}

// POST — body: { links: [{ orderId, sourceType, sourceId, amount, paidDate }] }
// 사용자가 확정한 조합을 erp_payment_matches에 기록한다 (멱등: 기배분 초과분은 건너뜀).
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as {
    links?: { orderId: string; sourceType: 'bank' | 'card'; sourceId: string; amount: number; paidDate: string }[]
  } | null
  const links = (body?.links ?? []).filter(l => l.orderId && l.sourceId && l.amount > 0)
  if (!links.length) return NextResponse.json({ error: '확정할 연결이 없습니다.' }, { status: 400 })

  const rows = links.map(l => ({
    order_id: l.orderId,
    source_type: l.sourceType,
    source_id: l.sourceId,
    amount: l.amount,
    paid_date: l.paidDate.slice(0, 10),
    matched_by: 'manual',
    memo: '수금후보 확정',
  }))
  const { error } = await admin.from('erp_payment_matches').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ linked: rows.length, amount: rows.reduce((s, r) => s + r.amount, 0) })
}
