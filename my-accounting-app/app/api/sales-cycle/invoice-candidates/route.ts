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
// 사용자가 확정한 조합을 erp_order_invoices에 기록하고,
// 계산서에 이미 매칭된 입금이 있으면 주문 수금배분으로 이월한다.
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

  const propagated = await propagatePayments(admin, links)

  return NextResponse.json({
    linked: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
    propagated,
  })
}

// ── 수금 이월 ──────────────────────────────────────────────────
// 주문-계산서 연결이 확정되면, 그 계산서에 매칭된 입금(tax_invoice_payments)을
// 찾아 주문 수금배분(erp_payment_matches)을 자동 생성한다.
// 이월 금액은 안전하게 4중 상한: 연결 금액 / 계산서별 결제 금액 /
// 입금의 미배분 잔액 / 주문의 수금 미배분 잔액 — 과배분이 원천적으로 불가능하다.
async function propagatePayments(
  admin: ReturnType<typeof createAdminClient>,
  links: { orderId: string; taxInvoiceId: string; amount: number }[],
): Promise<{ count: number; amount: number }> {
  const result = { count: 0, amount: 0 }
  try {
    // 주문별 수금 여유 = 순매출 - 기존 수금배분
    const orderIds = Array.from(new Set(links.map(l => l.orderId)))
    const orderPayCap = new Map<string, number>()
    for (const oid of orderIds) {
      const { data: ord } = await admin.from('erp_orders').select('total_amount').eq('id', oid).single()
      const { data: items } = await admin.from('erp_order_items')
        .select('line_total')
        .eq('order_id', oid)
        .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
      const net = (ord?.total_amount ?? 0) - (items ?? []).reduce((s, r) => s + ((r.line_total as number) ?? 0), 0)
      const { data: alloc } = await admin.from('erp_payment_matches').select('amount').eq('order_id', oid)
      orderPayCap.set(oid, net - (alloc ?? []).reduce((s, r) => s + (r.amount as number), 0))
    }

    for (const l of links) {
      let remain = l.amount
      let cap = orderPayCap.get(l.orderId) ?? 0
      if (cap <= 0) continue

      const { data: pays } = await admin.from('tax_invoice_payments')
        .select('amount, transaction:transactions(id, tx_date, amount_in)')
        .eq('tax_invoice_id', l.taxInvoiceId)
        .gt('amount', 0)
        .order('created_at', { ascending: true })
      for (const p of pays ?? []) {
        if (remain <= 0 || cap <= 0) break
        const tx = p.transaction as unknown as { id: string; tx_date: string; amount_in: number | null } | null
        if (!tx || !(tx.amount_in && tx.amount_in > 0)) continue
        // 입금의 미배분 잔액 (다른 주문에 이미 배분된 금액 차감)
        const { data: srcAlloc } = await admin.from('erp_payment_matches')
          .select('amount')
          .eq('source_type', 'bank')
          .eq('source_id', tx.id)
        const depCap = tx.amount_in - (srcAlloc ?? []).reduce((s, r) => s + (r.amount as number), 0)
        const amt = Math.min(remain, cap, p.amount as number, depCap)
        if (amt <= 0) continue
        const { error } = await admin.from('erp_payment_matches').insert({
          order_id: l.orderId,
          source_type: 'bank',
          source_id: tx.id,
          amount: amt,
          paid_date: tx.tx_date,
          matched_by: 'auto',
          memo: '계산서 매칭 이월',
        })
        if (error) continue
        remain -= amt
        cap -= amt
        result.count++
        result.amount += amt
      }
      orderPayCap.set(l.orderId, cap)
    }
  } catch {
    // 이월 실패는 연결 자체에 영향 주지 않는다 (수금후보로 언제든 보완 가능)
  }
  return result
}
