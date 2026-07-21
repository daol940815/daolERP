import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildInvoiceLinkCandidates, isMissingOrderInvoiceTable } from '@/lib/order-invoice-match'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIGRATION_HINT = '067 마이그레이션(erp_order_invoices) 적용이 필요합니다. Supabase SQL 편집기에서 067_erp_order_invoices.sql을 실행해주세요.'

// GET /api/sales-cycle/invoice-candidates?vendorId=...
// 한 매출처의 주문 ↔ 계산서 연결 후보(1:1·합산·분할)를 계산해 내려준다. 추천만 — 확정은 POST.
export async function GET(req: NextRequest) {
  const vendorId = new URL(req.url).searchParams.get('vendorId')
  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })

  const admin = createAdminClient()
  const result = await buildInvoiceLinkCandidates(admin, vendorId)
  if ('error' in result) {
    return NextResponse.json(
      { error: result.missingTable ? MIGRATION_HINT : result.error },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ...result,
    summary: {
      open_orders: result.orders.length,
      available_invoices: result.invoices.length,
      groups: result.groups.length,
      coverable_amount: result.groups.reduce((s, g) => s + g.amount, 0),
    },
  })
}

// POST — body: { links: [{ orderId, taxInvoiceId, amount, issueDate }] }
// 사용자가 확정한 조합을 erp_order_invoices에 기록한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as {
    links?: { orderId: string; taxInvoiceId: string; amount: number; issueDate: string }[]
  } | null
  const links = (body?.links ?? []).filter(l => l.orderId && l.taxInvoiceId && l.amount > 0)
  if (!links.length) return NextResponse.json({ error: '확정할 연결이 없습니다.' }, { status: 400 })

  const rows = links.map(l => ({
    order_id: l.orderId,
    tax_invoice_id: l.taxInvoiceId,
    amount: l.amount,
    issue_date: l.issueDate.slice(0, 10),
    matched_by: 'manual',
    memo: '계산서연결 확정',
  }))
  const { error } = await admin.from('erp_order_invoices').insert(rows)
  if (error) {
    return NextResponse.json(
      { error: isMissingOrderInvoiceTable(error.message) ? MIGRATION_HINT : error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ linked: rows.length, amount: rows.reduce((s, r) => s + r.amount, 0) })
}
