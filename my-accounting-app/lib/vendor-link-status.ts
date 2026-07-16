import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// 거래처 연동 현황 집계 (재정비 4단계) — 대시보드 카드와 상태 API가 공용.
export interface VendorLinkStatus {
  erp: {
    order_count: number
    order_linked_count: number
    amount_total: number
    amount_linked: number
    ratio: number
  }
  alias_pending: number
  untagged_transactions: number
  untagged_card_sales: number
}

export async function buildVendorLinkStatus(admin: SupabaseClient): Promise<VendorLinkStatus | { error: string }> {
  // 1) ERP 별칭 등록 대기 (066 미적용 환경 폴백 포함)
  let aliasResult = await fetchAllRows<{ id: string; excluded?: boolean | null }>((f, t) =>
    admin.from('erp_vendor_aliases').select('id, excluded')
      .is('vendor_id', null).is('merged_into_alias_id', null).range(f, t),
  )
  if ('error' in aliasResult) {
    aliasResult = await fetchAllRows<{ id: string }>((f, t) =>
      admin.from('erp_vendor_aliases').select('id')
        .is('vendor_id', null).is('merged_into_alias_id', null).range(f, t),
    )
  }
  if ('error' in aliasResult) return { error: aliasResult.error }
  const aliasPending = aliasResult.data.filter(a => !a.excluded).length

  // 2) ERP 주문 연동률 (금액 기준)
  const ordersResult = await fetchAllRows<{ customer_alias_id: string | null; total_amount: number | null }>((f, t) =>
    admin.from('erp_orders').select('customer_alias_id, total_amount').range(f, t),
  )
  if ('error' in ordersResult) return { error: ordersResult.error }
  const linkedAliasResult = await fetchAllRows<{ id: string }>((f, t) =>
    admin.from('erp_vendor_aliases').select('id').not('vendor_id', 'is', null).range(f, t),
  )
  if ('error' in linkedAliasResult) return { error: linkedAliasResult.error }
  const linkedSet = new Set(linkedAliasResult.data.map(a => a.id))
  let amountTotal = 0, amountLinked = 0, orderCount = 0, orderLinkedCount = 0
  for (const o of ordersResult.data) {
    const amt = o.total_amount ?? 0
    amountTotal += amt; orderCount++
    if (o.customer_alias_id && linkedSet.has(o.customer_alias_id)) { amountLinked += amt; orderLinkedCount++ }
  }

  // 3) 통장 거래처 미태깅 (이체쌍 제외)
  const { count: untaggedTx } = await admin
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .is('vendor_id', null)
    .is('transfer_pair_id', null)

  // 4) 카드매출 미태깅
  const { count: untaggedCardSales } = await admin
    .from('card_sales')
    .select('id', { count: 'exact', head: true })
    .is('vendor_id', null)

  return {
    erp: {
      order_count: orderCount,
      order_linked_count: orderLinkedCount,
      amount_total: amountTotal,
      amount_linked: amountLinked,
      ratio: amountTotal > 0 ? amountLinked / amountTotal : 1,
    },
    alias_pending: aliasPending,
    untagged_transactions: untaggedTx ?? 0,
    untagged_card_sales: untaggedCardSales ?? 0,
  }
}
