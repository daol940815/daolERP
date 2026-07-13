import type { SupabaseClient } from '@supabase/supabase-js'
import type { VendorAnalysisRow } from '@/types/erp'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ── 거래처별 매출/수익성 분석 ────────────────────────────
// 기간 내 erp_orders + erp_order_items(취소/VIP/선결제 제외)를 매출처(고객 alias) 기준으로 집계
// 매출(line_total) 대비 매입원가(purchase_total)로 매출이익/이익률을 함께 산출한다.
//
// 1순위: DB 집계 RPC(vendor_sales_analysis) — 왕복 1회, 큰 기간에서도 빠름.
// 폴백: RPC가 아직 없으면(마이그레이션 035 미적용) 앱-사이드 조인 집계로 동작.

type AggRow = {
  alias_id: string | null
  erp_name: string | null
  vendor_id: string | null
  vendor_name: string | null
  order_count: number | string | null
  item_count: number | string | null
  quantity: number | string | null
  sales_amount: number | string | null
  purchase_amount: number | string | null
}

function toRow(r: AggRow): VendorAnalysisRow {
  const sales = Number(r.sales_amount) || 0
  const purchase = Number(r.purchase_amount) || 0
  const profit = sales - purchase
  return {
    alias_id: r.alias_id ?? null,
    erp_name: r.erp_name ?? '매출처 미지정',
    vendor_id: r.vendor_id ?? null,
    vendor_name: r.vendor_name ?? null,
    order_count: Number(r.order_count) || 0,
    item_count: Number(r.item_count) || 0,
    quantity: Number(r.quantity) || 0,
    sales_amount: sales,
    purchase_amount: purchase,
    profit_amount: profit,
    profit_rate: sales > 0 ? (profit / sales) * 100 : 0,
  }
}

export async function buildVendorAnalysisRows(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<{ rows: VendorAnalysisRow[] } | { error: string }> {
  const { data, error } = await admin.rpc('vendor_sales_analysis', { p_from: from, p_to: to })

  if (error) {
    // 함수 미존재(PGRST202) = 마이그레이션 035 미적용 → 조인 기반 폴백으로 동작
    const missing = error.code === 'PGRST202' || /vendor_sales_analysis/.test(error.message ?? '')
    if (!missing) return { error: error.message }
    return buildFromItemsJoin(admin, from, to)
  }

  const rows = ((data ?? []) as AggRow[]).map(toRow)
  rows.sort((a, b) => b.sales_amount - a.sales_amount)
  return { rows }
}

// ── 폴백: erp_order_items ⨝ erp_orders 조인 단일 스트림 집계 (RPC 미적용 시) ──
async function buildFromItemsJoin(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<{ rows: VendorAnalysisRow[] } | { error: string }> {
  // 매출처(고객) 별칭 — 거래처명/연결 표시용 (전수)
  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string | null; vendor_id: string | null; vendors: unknown }>((rFrom, rTo) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, vendors(name)')
      .eq('alias_type', 'customer')
      .range(rFrom, rTo),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasInfo = new Map(aliasesResult.data.map(a => [a.id, a]))

  const itemsResult = await fetchAllRows<{
    order_id: string
    line_total: number | null
    purchase_total: number | null
    quantity: number | null
    erp_orders: unknown
  }>((rFrom, rTo) => {
    let iq = admin
      .from('erp_order_items')
      .select('order_id, line_total, purchase_total, quantity, erp_orders!inner(customer_alias_id, bank_name, branch_name, order_date)')
      .eq('is_canceled', false)
      .eq('is_vip', false)
      .eq('is_prepayment', false)
    if (from) iq = iq.gte('erp_orders.order_date', from)
    if (to)   iq = iq.lte('erp_orders.order_date', to)
    return iq.range(rFrom, rTo)
  })
  if ('error' in itemsResult) return { error: itemsResult.error }

  const groups = new Map<string, VendorAnalysisRow & { orderIds: Set<string> }>()

  for (const it of itemsResult.data) {
    const o = (it.erp_orders ?? null) as { customer_alias_id: string | null; bank_name: string | null; branch_name: string | null } | null
    if (!o) continue
    const orderId = it.order_id as string
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
