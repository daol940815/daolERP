import type { SupabaseClient } from '@supabase/supabase-js'
import type { VendorAnalysisRow } from '@/types/erp'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ── 거래처별 매출/수익성 분석 ────────────────────────────
// 기간 내 erp_orders + erp_order_items(취소/VIP/선결제 제외)를 매출처(고객 alias) 기준으로 집계
// 매출(line_total) 대비 매입원가(purchase_total)로 매출이익/이익률을 함께 산출한다.
export async function buildVendorAnalysisRows(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<{ rows: VendorAnalysisRow[] } | { error: string }> {
  const ordersResult = await fetchAllRows<{ id: string; customer_alias_id: string | null; bank_name: string | null; branch_name: string | null }>((rFrom, rTo) => {
    let oq = admin
      .from('erp_orders')
      .select('id, customer_alias_id, bank_name, branch_name')
      .range(rFrom, rTo)
    if (from) oq = oq.gte('order_date', from)
    if (to)   oq = oq.lte('order_date', to)
    return oq
  })
  if ('error' in ordersResult) return { error: ordersResult.error }
  const orders = ordersResult.data

  const orderInfo = new Map(orders.map(o => [o.id, o]))
  const orderIds = orders.map(o => o.id)

  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string | null; vendor_id: string | null; vendors: unknown }>((rFrom, rTo) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, vendors(name)')
      .eq('alias_type', 'customer')
      .range(rFrom, rTo),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasInfo = new Map(aliasesResult.data.map(a => [a.id, a]))

  const groups = new Map<string, VendorAnalysisRow & { orderIds: Set<string> }>()

  for (let i = 0; i < orderIds.length; i += 500) {
    const idChunk = orderIds.slice(i, i + 500)
    const itemsResult = await fetchAllRows<{ order_id: string; line_total: number | null; purchase_total: number | null; quantity: number | null }>((rFrom, rTo) =>
      admin
        .from('erp_order_items')
        .select('order_id, line_total, purchase_total, quantity')
        .in('order_id', idChunk)
        .eq('is_canceled', false)
        .eq('is_vip', false)
        .eq('is_prepayment', false)
        .range(rFrom, rTo),
    )
    if ('error' in itemsResult) return { error: itemsResult.error }

    for (const it of itemsResult.data) {
      const orderId = it.order_id as string
      const o = orderInfo.get(orderId)
      if (!o) continue
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
          item_count: 0,
          quantity: 0,
          sales_amount: 0,
          purchase_amount: 0,
          profit_amount: 0,
          profit_rate: 0,
          orderIds: new Set<string>(),
        }
        groups.set(key, g)
      }
      g.orderIds.add(orderId)
      g.item_count += 1
      g.quantity += (it.quantity as number) || 0
      g.sales_amount += (it.line_total as number) || 0
      g.purchase_amount += (it.purchase_total as number) || 0
    }
  }

  const rows: VendorAnalysisRow[] = Array.from(groups.values()).map(g => {
    const profit = g.sales_amount - g.purchase_amount
    return {
      alias_id: g.alias_id,
      erp_name: g.erp_name,
      vendor_id: g.vendor_id,
      vendor_name: g.vendor_name,
      order_count: g.orderIds.size,
      item_count: g.item_count,
      quantity: g.quantity,
      sales_amount: g.sales_amount,
      purchase_amount: g.purchase_amount,
      profit_amount: profit,
      profit_rate: g.sales_amount > 0 ? (profit / g.sales_amount) * 100 : 0,
    }
  })

  rows.sort((a, b) => b.sales_amount - a.sales_amount)
  return { rows }
}
