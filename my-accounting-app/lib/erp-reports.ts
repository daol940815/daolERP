import type { SupabaseClient } from '@supabase/supabase-js'
import type { ErpReceivableRow, ErpPayableRow, ErpPaymentTerm } from '@/types/erp'

// ── 매출처(은행·지점)별 미수금 현황 집계 ──────────────
// 취소/VIP/선결제 품목은 순매출에서 제외, 미수금은 ERP 주문 단위 값 사용
export async function buildReceivableRows(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<{ rows: ErpReceivableRow[] } | { error: string }> {
  let oq = admin
    .from('erp_orders')
    .select('id, customer_alias_id, bank_name, branch_name, total_amount, outstanding_amount, collect_status')
    .limit(50000)
  if (from) oq = oq.gte('order_date', from)
  if (to)   oq = oq.lte('order_date', to)

  const { data: orders, error: oe } = await oq
  if (oe) return { error: oe.message }

  const orderIds = (orders ?? []).map(o => o.id as string)

  // 주문별 제외 금액(취소/VIP/선결제 품목 합계)
  const excludedByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data: items, error: ie } = await admin
      .from('erp_order_items')
      .select('order_id, line_total, is_canceled, is_vip, is_prepayment')
      .in('order_id', orderIds.slice(i, i + 500))
      .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
    if (ie) return { error: ie.message }
    for (const it of items ?? []) {
      const cur = excludedByOrder.get(it.order_id as string) ?? 0
      excludedByOrder.set(it.order_id as string, cur + ((it.line_total as number) || 0))
    }
  }

  // 별칭 정보 + 거래처명
  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, erp_name, vendor_id, vendors(name)')
    .eq('alias_type', 'customer')
  if (ae) return { error: ae.message }
  const aliasInfo = new Map((aliases ?? []).map(a => [a.id as string, a]))

  // 선결제 잔액 (매출처)
  const { data: prepays, error: pe } = await admin
    .from('erp_prepayments')
    .select('alias_id, entry_type, amount')
    .eq('direction', 'customer')
  if (pe) return { error: pe.message }
  const prepayBalance = new Map<string, number>()
  for (const e of prepays ?? []) {
    const cur = prepayBalance.get(e.alias_id as string) ?? 0
    prepayBalance.set(e.alias_id as string, cur + (e.entry_type === 'deposit' ? e.amount : -e.amount))
  }

  const groups = new Map<string, ErpReceivableRow>()
  for (const o of orders ?? []) {
    const key = (o.customer_alias_id as string | null) ?? '__none__'
    let g = groups.get(key)
    if (!g) {
      const alias = key === '__none__' ? null : aliasInfo.get(key)
      g = {
        alias_id: key === '__none__' ? null : key,
        erp_name: (alias?.erp_name as string | undefined)
          ?? [o.bank_name, o.branch_name].filter(Boolean).join(' ')
          ?? '매출처 미지정',
        vendor_id: (alias?.vendor_id as string | null) ?? null,
        vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
        order_count: 0,
        total_amount: 0,
        excluded_amount: 0,
        outstanding_amount: 0,
        outstanding_count: 0,
        prepay_balance: prepayBalance.get(key) ?? 0,
      }
      groups.set(key, g)
    }
    const excluded = excludedByOrder.get(o.id as string) ?? 0
    g.order_count += 1
    g.total_amount += ((o.total_amount as number) || 0) - excluded
    g.excluded_amount += excluded
    if (o.collect_status !== 'collected') {
      g.outstanding_amount += (o.outstanding_amount as number) || 0
      g.outstanding_count  += 1
    }
  }

  const rows = Array.from(groups.values())
  rows.sort((a, b) => b.outstanding_amount - a.outstanding_amount || b.total_amount - a.total_amount)
  return { rows }
}

// ── 매입처 × 정산월별 미결제 현황 집계 ─────────────────
// 취소/VIP/선결제 품목 제외, 정산월(settlement_month) 기준 그룹핑
export async function buildPayableRows(
  admin: SupabaseClient,
  monthFrom: string | null,  // 'YYYY-MM'
  monthTo: string | null,
): Promise<{ rows: ErpPayableRow[] } | { error: string }> {
  let iq = admin
    .from('erp_order_items')
    .select('purchase_alias_id, purchase_vendor_name, purchase_total, settlement_month')
    .eq('is_canceled', false)
    .eq('is_vip', false)
    .eq('is_prepayment', false)
    .not('purchase_alias_id', 'is', null)
    .limit(100000)
  if (monthFrom) iq = iq.gte('settlement_month', monthFrom)
  if (monthTo)   iq = iq.lte('settlement_month', monthTo)

  const { data: items, error: ie } = await iq
  if (ie) return { error: ie.message }

  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, erp_name, vendor_id, payment_term, vendors(name)')
    .eq('alias_type', 'purchase')
  if (ae) return { error: ae.message }
  const aliasInfo = new Map((aliases ?? []).map(a => [a.id as string, a]))

  const { data: settlements, error: se } = await admin
    .from('erp_purchase_settlements')
    .select('id, purchase_alias_id, settlement_month, status, paid_date, paid_amount, memo')
  if (se) return { error: se.message }
  const settleMap = new Map(
    (settlements ?? []).map(s => [`${s.purchase_alias_id}|${s.settlement_month}`, s]))

  const { data: prepays, error: pe } = await admin
    .from('erp_prepayments')
    .select('alias_id, entry_type, amount')
    .eq('direction', 'purchase')
  if (pe) return { error: pe.message }
  const prepayBalance = new Map<string, number>()
  for (const e of prepays ?? []) {
    const cur = prepayBalance.get(e.alias_id as string) ?? 0
    prepayBalance.set(e.alias_id as string, cur + (e.entry_type === 'deposit' ? e.amount : -e.amount))
  }

  const groups = new Map<string, ErpPayableRow>()
  for (const it of items ?? []) {
    const aliasId = it.purchase_alias_id as string
    const month   = (it.settlement_month as string | null) ?? '미지정'
    const key     = `${aliasId}|${month}`
    let g = groups.get(key)
    if (!g) {
      const alias  = aliasInfo.get(aliasId)
      const settle = settleMap.get(key)
      g = {
        alias_id: aliasId,
        erp_name: (alias?.erp_name as string | undefined) ?? (it.purchase_vendor_name as string | null) ?? '매입처 미지정',
        vendor_id: (alias?.vendor_id as string | null) ?? null,
        vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
        payment_term: ((alias?.payment_term as ErpPaymentTerm | undefined) ?? 'monthly'),
        settlement_month: month,
        item_count: 0,
        purchase_total: 0,
        settlement_id: (settle?.id as string | undefined) ?? null,
        status: ((settle?.status as 'unpaid' | 'paid' | undefined) ?? 'unpaid'),
        paid_date: (settle?.paid_date as string | null) ?? null,
        paid_amount: (settle?.paid_amount as number | null) ?? null,
        settlement_memo: (settle?.memo as string | null) ?? null,
        prepay_balance: prepayBalance.get(aliasId) ?? 0,
      }
      groups.set(key, g)
    }
    g.item_count += 1
    g.purchase_total += (it.purchase_total as number) || 0
  }

  const rows = Array.from(groups.values())
  rows.sort((a, b) =>
    b.settlement_month.localeCompare(a.settlement_month) ||
    (a.status === 'unpaid' ? -1 : 1) - (b.status === 'unpaid' ? -1 : 1) ||
    b.purchase_total - a.purchase_total)
  return { rows }
}
