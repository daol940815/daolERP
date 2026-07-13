import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/purchase-cycle/month-detail?vendorId=&month=YYYY-MM
// 거래처 진행상태 화면의 드릴다운: 한 달의 근거 레코드(ERP 품목·계산서·지급)를 내려준다.
// 집계 기준은 060 RPC와 동일해야 한다:
//   ERP  — 정산월(settlement_month) 우선, 없으면 주문월 · 취소 제외
//   계산서 — 발행월(issue_date)
//   지급 — 결제연결의 거래일 + 미지급금(2001) 확정 출금(결제연결 없는 것)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendorId')
  const month = sp.get('month')
  if (!vendorId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'vendorId와 month(YYYY-MM)가 필요합니다.' }, { status: 400 })
  }
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const d = new Date(y, m, 0)
  const last = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // ── ERP 품목 ──
  const { data: aliases } = await admin
    .from('erp_vendor_aliases').select('id').eq('vendor_id', vendorId)
  const aliasIds = (aliases ?? []).map(a => a.id as string)

  type ErpItem = {
    id: string; item_name: string | null; quantity: number | null
    purchase_total: number | null; settlement_month: string | null
    erp_orders: { order_date: string } | null
  }
  const erpItems: ErpItem[] = []
  if (aliasIds.length) {
    // (a) 정산월이 이 달로 지정된 품목 (주문일은 다른 달일 수 있음)
    const { data: bySettle } = await admin
      .from('erp_order_items')
      .select('id, item_name, quantity, purchase_total, settlement_month, erp_orders!inner(order_date)')
      .in('purchase_alias_id', aliasIds)
      .eq('is_canceled', false)
      .like('settlement_month', `${month}%`)
      .limit(500)
    // (b) 정산월 미지정 + 주문일이 이 달인 품목
    const { data: byOrder } = await admin
      .from('erp_order_items')
      .select('id, item_name, quantity, purchase_total, settlement_month, erp_orders!inner(order_date)')
      .in('purchase_alias_id', aliasIds)
      .eq('is_canceled', false)
      .or('settlement_month.is.null,settlement_month.eq.')
      .gte('erp_orders.order_date', first)
      .lte('erp_orders.order_date', last)
      .limit(500)
    const seen = new Set<string>()
    for (const it of [...(bySettle ?? []), ...(byOrder ?? [])] as unknown as ErpItem[]) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      erpItems.push(it)
    }
    erpItems.sort((a, b) => (a.erp_orders?.order_date ?? '').localeCompare(b.erp_orders?.order_date ?? ''))
  }

  // ── 계산서 (발행월) ──
  const { data: invoices } = await admin
    .from('tax_invoices')
    .select('id, issue_date, item_name, supply_amount, total_amount, payment_status')
    .eq('direction', 'purchase')
    .eq('vendor_id', vendorId)
    .gte('issue_date', first)
    .lte('issue_date', last)
    .order('issue_date')
    .limit(500)

  // ── 지급: 결제연결(거래일이 이 달) ──
  const { data: linkedPays } = await admin
    .from('tax_invoice_payments')
    .select('amount, tax_invoices!inner(vendor_id, direction), transactions!inner(id, tx_date, description)')
    .eq('tax_invoices.vendor_id', vendorId)
    .eq('tax_invoices.direction', 'purchase')
    .gte('transactions.tx_date', first)
    .lte('transactions.tx_date', last)
    .limit(500)
  type LinkedPay = { amount: number; transactions: { id: string; tx_date: string; description: string | null } | null }
  const payments = ((linkedPays ?? []) as unknown as LinkedPay[])
    .filter(p => p.transactions)
    .map(p => ({
      transaction_id: p.transactions!.id,
      tx_date: p.transactions!.tx_date,
      description: p.transactions!.description,
      amount: p.amount,
      source: '계산서 결제연결' as string,
    }))

  // ── 지급: 미지급금(2001) 확정 출금 중 결제연결이 없는 것 (RPC와 동일한 이중집계 방지) ──
  const { data: acc2001 } = await admin.from('accounts').select('id').eq('code', '2001').maybeSingle()
  if (acc2001) {
    const { data: offsetTxs } = await admin
      .from('transactions')
      .select('id, tx_date, description, amount_out')
      .eq('vendor_id', vendorId)
      .eq('status', 'confirmed')
      .eq('confirmed_account_id', acc2001.id)
      .gt('amount_out', 0)
      .gte('tx_date', first)
      .lte('tx_date', last)
      .limit(500)
    const txIds = (offsetTxs ?? []).map(t => t.id as string)
    const linkedTxIds = new Set<string>()
    if (txIds.length) {
      const { data: linked } = await admin
        .from('tax_invoice_payments').select('transaction_id').in('transaction_id', txIds)
      for (const l of linked ?? []) linkedTxIds.add(l.transaction_id as string)
    }
    for (const t of offsetTxs ?? []) {
      if (linkedTxIds.has(t.id as string)) continue
      payments.push({
        transaction_id: t.id as string,
        tx_date: t.tx_date as string,
        description: t.description as string | null,
        amount: t.amount_out as number,
        source: '미지급금(2001) 확정 출금',
      })
    }
  }
  payments.sort((a, b) => a.tx_date.localeCompare(b.tx_date))

  return NextResponse.json({
    month,
    erp_items: erpItems.map(it => ({
      id: it.id,
      order_date: it.erp_orders?.order_date ?? null,
      item_name: it.item_name,
      quantity: it.quantity,
      purchase_total: it.purchase_total ?? 0,
      settlement_month: it.settlement_month,
    })),
    invoices: invoices ?? [],
    payments,
  })
}
