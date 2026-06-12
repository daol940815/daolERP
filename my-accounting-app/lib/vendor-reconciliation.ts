import type { SupabaseClient } from '@supabase/supabase-js'

// 거래처 단위 대조: ERP 매출/매입 vs 입출금·카드·현금영수증·세금계산서
export interface ReconciliationRow {
  vendor_id: string
  vendor_name: string
  erp_amount: number        // sales: 순매출(취소/VIP/선결제 제외) / purchase: 매입 합계
  erp_outstanding: number   // sales 전용: ERP 기준 미수금
  bank_amount: number       // sales: 입금 합계 / purchase: 출금 합계
  card_amount: number       // sales 전용: 카드매출 (취소 차감)
  cash_amount: number       // 현금영수증 (취소 차감)
  invoice_amount: number    // 세금계산서 합계
  payment_total: number     // bank + card + cash
  diff_payment: number      // erp_amount − payment_total
  diff_invoice: number      // erp_amount − invoice_amount
}

export async function buildReconciliationRows(
  admin: SupabaseClient,
  direction: 'sales' | 'purchase',
  from: string | null,
  to: string | null,
): Promise<{ rows: ReconciliationRow[] } | { error: string }> {

  // 별칭 → 거래처 매핑 (매칭 완료 건만 대조 대상)
  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, vendor_id')
    .eq('alias_type', direction === 'sales' ? 'customer' : 'purchase')
    .not('vendor_id', 'is', null)
  if (ae) return { error: ae.message }
  const aliasToVendor = new Map((aliases ?? []).map(a => [a.id as string, a.vendor_id as string]))

  const { data: vendorRows, error: ve } = await admin
    .from('vendors')
    .select('id, name')
    .limit(20000)
  if (ve) return { error: ve.message }
  const vendorName = new Map((vendorRows ?? []).map(v => [v.id as string, v.name as string]))

  const rowMap = new Map<string, ReconciliationRow>()
  const row = (vendorId: string): ReconciliationRow => {
    let r = rowMap.get(vendorId)
    if (!r) {
      r = {
        vendor_id: vendorId,
        vendor_name: vendorName.get(vendorId) ?? '(삭제된 거래처)',
        erp_amount: 0, erp_outstanding: 0,
        bank_amount: 0, card_amount: 0, cash_amount: 0, invoice_amount: 0,
        payment_total: 0, diff_payment: 0, diff_invoice: 0,
      }
      rowMap.set(vendorId, r)
    }
    return r
  }

  // ── 1) ERP 금액 ────────────────────────────────────
  if (direction === 'sales') {
    let oq = admin
      .from('erp_orders')
      .select('id, customer_alias_id, total_amount, outstanding_amount, collect_status')
      .not('customer_alias_id', 'is', null)
      .limit(50000)
    if (from) oq = oq.gte('order_date', from)
    if (to)   oq = oq.lte('order_date', to)
    const { data: orders, error: oe } = await oq
    if (oe) return { error: oe.message }

    // 취소/VIP/선결제 품목 합계 → 순매출에서 제외
    const matched = (orders ?? []).filter(o => aliasToVendor.has(o.customer_alias_id as string))
    const orderIds = matched.map(o => o.id as string)
    const excludedByOrder = new Map<string, number>()
    for (let i = 0; i < orderIds.length; i += 500) {
      const { data: items, error: ie } = await admin
        .from('erp_order_items')
        .select('order_id, line_total')
        .in('order_id', orderIds.slice(i, i + 500))
        .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
      if (ie) return { error: ie.message }
      for (const it of items ?? []) {
        const cur = excludedByOrder.get(it.order_id as string) ?? 0
        excludedByOrder.set(it.order_id as string, cur + ((it.line_total as number) || 0))
      }
    }
    for (const o of matched) {
      const vendorId = aliasToVendor.get(o.customer_alias_id as string)!
      const r = row(vendorId)
      r.erp_amount += ((o.total_amount as number) || 0) - (excludedByOrder.get(o.id as string) ?? 0)
      if (o.collect_status !== 'collected') r.erp_outstanding += (o.outstanding_amount as number) || 0
    }
  } else {
    let iq = admin
      .from('erp_order_items')
      .select('purchase_alias_id, purchase_total, erp_orders!inner(order_date)')
      .eq('is_canceled', false)
      .eq('is_vip', false)
      .eq('is_prepayment', false)
      .not('purchase_alias_id', 'is', null)
      .limit(100000)
    if (from) iq = iq.gte('erp_orders.order_date', from)
    if (to)   iq = iq.lte('erp_orders.order_date', to)
    const { data: items, error: ie } = await iq
    if (ie) return { error: ie.message }
    for (const it of items ?? []) {
      const vendorId = aliasToVendor.get(it.purchase_alias_id as string)
      if (!vendorId) continue
      row(vendorId).erp_amount += (it.purchase_total as number) || 0
    }
  }

  // ── 2) 은행 입출금 ──────────────────────────────────
  {
    let tq = admin
      .from('transactions')
      .select('vendor_id, amount_in, amount_out')
      .not('vendor_id', 'is', null)
      .limit(100000)
    if (from) tq = tq.gte('tx_date', from)
    if (to)   tq = tq.lte('tx_date', to)
    if (direction === 'sales') tq = tq.gt('amount_in', 0)
    else                       tq = tq.gt('amount_out', 0)
    const { data: txs, error: te } = await tq
    if (te) return { error: te.message }
    for (const t of txs ?? []) {
      const amt = direction === 'sales' ? ((t.amount_in as number) || 0) : ((t.amount_out as number) || 0)
      row(t.vendor_id as string).bank_amount += amt
    }
  }

  // ── 3) 카드매출 (매출 대조 전용, 취소 차감) ─────────
  if (direction === 'sales') {
    let cq = admin
      .from('card_sales')
      .select('vendor_id, amount, transaction_type')
      .not('vendor_id', 'is', null)
      .limit(100000)
    if (from) cq = cq.gte('tx_date', from)
    if (to)   cq = cq.lte('tx_date', to)
    const { data: cards, error: ce } = await cq
    if (ce) return { error: ce.message }
    for (const c of cards ?? []) {
      const amt = (c.amount as number) || 0
      row(c.vendor_id as string).card_amount += c.transaction_type === 'cancel' ? -Math.abs(amt) : amt
    }
  }

  // ── 4) 현금영수증 (취소 차감) ───────────────────────
  {
    let rq = admin
      .from('cash_receipts')
      .select('vendor_id, amount, transaction_type')
      .eq('direction', direction)
      .not('vendor_id', 'is', null)
      .limit(100000)
    if (from) rq = rq.gte('tx_date', from)
    if (to)   rq = rq.lte('tx_date', to)
    const { data: receipts, error: re } = await rq
    if (re) return { error: re.message }
    for (const c of receipts ?? []) {
      const amt = (c.amount as number) || 0
      row(c.vendor_id as string).cash_amount += c.transaction_type === 'cancel' ? -Math.abs(amt) : amt
    }
  }

  // ── 5) 세금계산서 ──────────────────────────────────
  {
    let xq = admin
      .from('tax_invoices')
      .select('vendor_id, total_amount')
      .eq('direction', direction)
      .not('vendor_id', 'is', null)
      .limit(100000)
    if (from) xq = xq.gte('issue_date', from)
    if (to)   xq = xq.lte('issue_date', to)
    const { data: invoices, error: xe } = await xq
    if (xe) return { error: xe.message }
    for (const inv of invoices ?? []) {
      row(inv.vendor_id as string).invoice_amount += (inv.total_amount as number) || 0
    }
  }

  const rows = Array.from(rowMap.values())
  for (const r of rows) {
    r.payment_total = r.bank_amount + r.card_amount + r.cash_amount
    r.diff_payment  = r.erp_amount - r.payment_total
    r.diff_invoice  = r.erp_amount - r.invoice_amount
  }
  rows.sort((a, b) => Math.abs(b.diff_payment) - Math.abs(a.diff_payment) || b.erp_amount - a.erp_amount)
  return { rows }
}
