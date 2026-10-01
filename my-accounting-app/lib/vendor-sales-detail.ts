import type { SupabaseClient } from '@supabase/supabase-js'
import type { VendorOrderRow, VendorPreferredItemRow, VendorSalesDetail } from '@/types/vendor-sales'
import type { ErpCollectStatus } from '@/types/erp'
import { isMissingMatchTable } from '@/lib/erp-matching'
import { cutoffAlloc, outstandingOf } from '@/lib/receivable'

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
  source: string | null
  updated_at: string | null
}

// 매출처(거래처) 상세 페이지 — 연결된 ERP 매출 별칭들의 주문/품목을 모아
// 주문내역, 선호 품목(수량 상위), 순매출/순미수금(취소·VIP·선결제 제외 + 매칭 수금 차감)을 계산한다.
// 미수는 lib/receivable.ts 표준 규칙(= DB 뷰 v_erp_order_receivable)을 그대로 쓴다.
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
      .select('id, order_no, order_date, staff_name, manager_name, total_amount, outstanding_amount, collect_status, source, updated_at')
      .in('customer_alias_id', aliasIds)
      .order('order_date', { ascending: false })
      .range(rFrom, rTo),
  )
  if ('error' in ordersResult) return { error: ordersResult.error }
  const orders = ordersResult.data
  if (orders.length === 0) return { data: empty }

  const orderIds = orders.map(o => o.id)

  // 표준 미수(lib/receivable.ts)는 업로드 컷오프 판정에 입금일이 필요하다
  const matchesByOrder = new Map<string, { amount: number; paid_date: string | null }[]>()
  for (let i = 0; i < orderIds.length; i += 300) {
    const chunk = orderIds.slice(i, i + 300)
    const mRes = await fetchAllRows<{ order_id: string; amount: number; paid_date: string | null }>((rFrom, rTo) =>
      admin
        .from('erp_payment_matches')
        .select('order_id, amount, paid_date')
        .in('order_id', chunk)
        .range(rFrom, rTo),
    )
    if ('error' in mRes) {
      if (!isMissingMatchTable({ message: mRes.error })) return { error: mRes.error }
      break
    }
    for (const m of mRes.data) {
      const arr = matchesByOrder.get(m.order_id)
      if (arr) arr.push(m)
      else matchesByOrder.set(m.order_id, [m])
    }
  }

  // 품목 — 주문별 건수 + 순매출(비제외 합) + 선호 품목(품목명 그룹핑, 취소/VIP/선결제 제외) 집계
  const itemCountByOrder = new Map<string, number>()
  const netByOrder = new Map<string, number>()
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
      // 순매출 = 비제외 품목 합 (lib/receivable.ts 표준)
      netByOrder.set(orderId, (netByOrder.get(orderId) ?? 0) + ((it.line_total as number) || 0))
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
    const netAmount = netByOrder.get(o.id) ?? 0
    const remaining = outstandingOf(o, { net: netAmount, alloc: cutoffAlloc(o, matchesByOrder.get(o.id)) })

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
