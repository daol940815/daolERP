import type { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1000

// PostgREST max-rows(기본 1000)를 넘는 단일 .limit() 요청은 조용히 잘려서 반환되므로
// range()로 페이지를 나눠 끝까지 읽어온다.
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

export interface AliasPurchaseAgg {
  alias_id: string | null
  erp_name: string
  vendor_id: string | null
  vendor_name: string | null
  cum_sales: number      // 누적 판매액 (line_total)
  cum_purchase: number   // 누적 매입액 (purchase_total)
  month_sales: number    // 당월 판매액
  month_purchase: number // 당월 매입액
}

// 매입처(공급사) 기준 누적/당월 판매·매입 집계 — erp_order_items.purchase_alias_id 그룹핑
// "당월"은 settlement_month(정산월) 기준 — 매입처 정산요약/월별정산현황과 동일한 기준을 사용한다.
// (취소/VIP/선결제 품목 제외)
//
// 1순위: DB 집계 RPC(vendor_purchase_analysis). 폴백: 마이그레이션 036 미적용 시 앱-집계.
export async function buildVendorPurchaseAnalysisRows(
  admin: SupabaseClient,
  currentMonth: string,
): Promise<{ rows: AliasPurchaseAgg[] } | { error: string }> {
  const { data, error } = await admin.rpc('vendor_purchase_analysis', { p_current_month: currentMonth })

  if (error) {
    const missing = error.code === 'PGRST202' || /vendor_purchase_analysis/.test(error.message ?? '')
    if (!missing) return { error: error.message }
    return buildFromItems(admin, currentMonth)
  }

  type AggRow = {
    alias_id: string | null; erp_name: string | null; vendor_id: string | null; vendor_name: string | null
    cum_sales: number | string | null; cum_purchase: number | string | null
    month_sales: number | string | null; month_purchase: number | string | null
  }
  const rows: AliasPurchaseAgg[] = ((data ?? []) as AggRow[]).map(r => ({
    alias_id: r.alias_id ?? null,
    erp_name: r.erp_name ?? '매입처 미지정',
    vendor_id: r.vendor_id ?? null,
    vendor_name: r.vendor_name ?? null,
    cum_sales: Number(r.cum_sales) || 0,
    cum_purchase: Number(r.cum_purchase) || 0,
    month_sales: Number(r.month_sales) || 0,
    month_purchase: Number(r.month_purchase) || 0,
  }))
  return { rows }
}

// ── 폴백: 앱-사이드 집계 (RPC 미적용 시) ──
async function buildFromItems(
  admin: SupabaseClient,
  currentMonth: string,
): Promise<{ rows: AliasPurchaseAgg[] } | { error: string }> {
  const itemsResult = await fetchAllRows<{
    purchase_alias_id: string | null
    line_total: number | null
    purchase_total: number | null
    settlement_month: string | null
  }>((rFrom, rTo) =>
    admin
      .from('erp_order_items')
      .select('purchase_alias_id, line_total, purchase_total, settlement_month')
      .eq('is_canceled', false)
      .eq('is_vip', false)
      .eq('is_prepayment', false)
      .range(rFrom, rTo),
  )
  if ('error' in itemsResult) return { error: itemsResult.error }

  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string | null; vendor_id: string | null; vendors: unknown }>((rFrom, rTo) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, vendors(name)')
      .eq('alias_type', 'purchase')
      .range(rFrom, rTo),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasInfo = new Map(aliasesResult.data.map(a => [a.id, a]))

  const groups = new Map<string, AliasPurchaseAgg>()

  for (const it of itemsResult.data) {
    const key = it.purchase_alias_id ?? '__none__'
    let g = groups.get(key)
    if (!g) {
      const alias = key === '__none__' ? null : aliasInfo.get(key)
      g = {
        alias_id: key === '__none__' ? null : key,
        erp_name: (alias?.erp_name as string | undefined) ?? '매입처 미지정',
        vendor_id: (alias?.vendor_id as string | null) ?? null,
        vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
        cum_sales: 0,
        cum_purchase: 0,
        month_sales: 0,
        month_purchase: 0,
      }
      groups.set(key, g)
    }
    const sales = it.line_total ?? 0
    const purchase = it.purchase_total ?? 0
    g.cum_sales += sales
    g.cum_purchase += purchase
    if (it.settlement_month === currentMonth) {
      g.month_sales += sales
      g.month_purchase += purchase
    }
  }

  return { rows: Array.from(groups.values()) }
}
