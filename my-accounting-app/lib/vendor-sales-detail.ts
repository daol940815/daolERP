import type { SupabaseClient } from '@supabase/supabase-js'
import type { VendorOrderRow, VendorPreferredItemRow, VendorSalesDetail } from '@/types/vendor-sales'
import type { ErpCollectStatus } from '@/types/erp'
import { isMissingMatchTable } from '@/lib/erp-matching'

const PAGE_SIZE = 1000

// Supabase 프로젝트의 PostgREST 설정(max-rows, 기본 1000)을 넘는 .limit() 요청은
// 서버가 조용히 잘라서 반환한다 — range()로 페이지를 나눠 끝까지 읽어와야 안전하다.
async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: rows }
}

type OrderRecord = {
  id: string
  order_no: string
  order_date: string
  staff_name: string | null
  manager_name: string | null
  total_amount: number
  outstanding_amount: number
  collect_status: ErpCollectStatus
}

// 매출처(거래처) 상세 페이지 — 연결된 ERP 매출 별칭들의 주문/품목을 모아
// 주문내역, 선호 품목(수량 상위), 순매출/순미수금(취소·VIP·선결제 제외 + 매칭 수금 차감)을 계산한다.
// lib/erp-reports.ts의 buildReceivableRows와 동일한 제외/매칭 규칙을 거래처 단위로 재적용한다.
export async function buildVendorSalesDetail(
  admin: SupabaseClient,
  vendorId: string,
  currentMonth: string, // 'YYYY-MM'
): Promise<{ data: VendorSalesDetail } | { error: string }> {
  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id')
    .eq('alias_type', 'customer')
    .eq('vendor_id', vendorId)
  if (ae) return { error: ae.message }
  const aliasIds = (aliases ?? []).map(a => a.id as string)

  const empty: VendorSalesDetail = {
    alias_ids: aliasIds, staff_names: [], orders: [], preferred_items: [],
    cum_sales: 0, cum_outstanding: 0, month_sales: 0,
  }
  if (aliasIds.length === 0) return { data: empty }

  const ordersResult = await fetchAllRows<OrderRecord>((rFrom, rTo) =>
    admin
      .from('erp_orders')
      .select('id, order_no, order_date, staff_name, manager_name, total_amount, outstanding_amount, collect_status')
      .in('customer_alias_id', aliasIds)
      .order('order_date', { ascending: false })
      .range(rFrom, rTo),
  )
  if ('error' in ordersResult) return { error: ordersResult.error }
  const orders = ordersResult.data
  if (orders.length === 0) return { data: empty }

  const orderIds = orders.map(o => o.id)

  const excludedByOrder = new Map<string, number>()
  const { data: exclusions, error: ie } = await admin
    .rpc('erp_order_item_exclusions', { p_order_ids: orderIds })
  if (ie) return { error: ie.message }
  for (const row of exclusions ?? []) {
    excludedByOrder.set(row.order_id as string, (row.excluded_amount as number) || 0)
  }

  const matchedByOrder = new Map<string, number>()
  const { data: matches, error: me } = await admin
    .rpc('erp_order_payment_matches', { p_order_ids: orderIds })
  if (me) {
    if (!isMissingMatchTable(me)) return { error: me.message }
  } else {
    for (const row of matches ?? []) {
      matchedByOrder.set(row.order_id as string, (row.matched_amount as number) || 0)
    }
  }

  // 품목 — 주문별 건수 + 선호 품목(품목명 그룹핑, 취소/VIP/선결제 제외) 집계
  const itemCountByOrder = new Map<string, number>()
  const itemGroups = new Map<string, { item_name: string; quantity: number; line_total: number; orderIds: Set<string> }>()

  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500)
    const itemsResult = await fetchAllRows<{ order_id: string; item_name: string | null; quantity: number | null; line_total: number | null; is_canceled: boolean | null; is_vip: boolean | null; is_prepayment: boolean | null }>((rFrom, rTo) =>
      admin
        .from('erp_order_items')
        .select('order_id, item_name, quantity, line_total, is_canceled, is_vip, is_prepayment')
        .in('order_id', chunk)
        .range(rFrom, rTo),
    )
    if ('error' in itemsResult) return { error: itemsResult.error }
    for (const it of itemsResult.data) {
      const orderId = it.order_id as string
      itemCountByOrder.set(orderId, (itemCountByOrder.get(orderId) ?? 0) + 1)
      if (it.is_canceled || it.is_vip || it.is_prepayment) continue
      const name = (it.item_name as string | null)?.trim() || '품목 미지정'
      let g = itemGroups.get(name)
      if (!g) {
        g = { item_name: name, quantity: 0, line_total: 0, orderIds: new Set() }
        itemGroups.set(name, g)
      }
      g.orderIds.add(orderId)
      g.quantity += (it.quantity as number) || 0
      g.line_total += (it.line_total as number) || 0
    }
  }

  const preferredItems: VendorPreferredItemRow[] = Array.from(itemGroups.values())
    .map(g => ({ item_name: g.item_name, order_count: g.orderIds.size, quantity: g.quantity, line_total: g.line_total }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  const staffSet = new Set<string>()
  let cumSales = 0
  let cumOutstanding = 0
  let monthSales = 0

  const orderRows: VendorOrderRow[] = orders.map(o => {
    const excluded = excludedByOrder.get(o.id) ?? 0
    const netAmount = (o.total_amount || 0) - excluded
    const matched = matchedByOrder.get(o.id) ?? 0
    const remaining = o.collect_status === 'collected' ? 0 : Math.max((o.outstanding_amount || 0) - matched, 0)

    const staffName = o.staff_name?.trim()
    if (staffName) staffSet.add(staffName)

    cumSales += netAmount
    cumOutstanding += remaining
    if (o.order_date.slice(0, 7) === currentMonth) monthSales += netAmount

    return {
      id: o.id,
      order_no: o.order_no,
      order_date: o.order_date,
      staff_name: o.staff_name,
      manager_name: o.manager_name,
      total_amount: netAmount,
      outstanding_amount: remaining,
      collect_status: o.collect_status,
      item_count: itemCountByOrder.get(o.id) ?? 0,
    }
  })

  return {
    data: {
      alias_ids: aliasIds,
      staff_names: Array.from(staffSet).sort((a, b) => a.localeCompare(b, 'ko')),
      orders: orderRows,
      preferred_items: preferredItems,
      cum_sales: cumSales,
      cum_outstanding: cumOutstanding,
      month_sales: monthSales,
    },
  }
}
