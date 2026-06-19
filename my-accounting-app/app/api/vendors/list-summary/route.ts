import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVendorPurchaseAnalysisRows } from '@/lib/vendor-purchase-analysis'
import { computeVendorBalances } from '@/lib/vendor-ledger'
import type { VendorPurchaseListRow } from '@/types/vendor-ledger'

export const dynamic = 'force-dynamic'

// GET /api/vendors/list-summary
// 매입처 목록 페이지: 매입처(vendors, type=vendor|both) + vendor_id가 연결되지 않은 매입 alias를
// 한 화면에 모아 미지급액/누적·당월 판매·매입·이익을 보여준다.
export async function GET() {
  const admin = createAdminClient()

  const { data: vendors, error: ve } = await admin
    .from('vendors')
    .select('id, name')
    .in('type', ['vendor', 'both'])
    .eq('is_active', true)
    .order('name')
  if (ve) return NextResponse.json({ error: ve.message }, { status: 500 })

  const currentMonth = new Date().toISOString().slice(0, 7)
  const purchaseResult = await buildVendorPurchaseAnalysisRows(admin, currentMonth)
  if ('error' in purchaseResult) return NextResponse.json({ error: purchaseResult.error }, { status: 500 })

  const vendorIds = (vendors ?? []).map(v => v.id as string)
  const balances = await computeVendorBalances(admin, vendorIds)
  if ('error' in balances) return NextResponse.json({ error: balances.error }, { status: 500 })

  const byVendor = new Map<string, VendorPurchaseListRow>()
  for (const v of vendors ?? []) {
    byVendor.set(v.id as string, {
      vendor_id: v.id as string,
      alias_ids: [],
      name: v.name as string,
      linked: true,
      unpaid_balance: balances.get(v.id as string)?.balance ?? 0,
      cum_sales: 0, cum_purchase: 0, cum_profit: 0,
      month_sales: 0, month_purchase: 0, month_profit: 0,
    })
  }

  const unlinkedRows: VendorPurchaseListRow[] = []

  for (const r of purchaseResult.rows) {
    if (!r.alias_id) continue // 매입처(alias) 미지정 품목은 거래처 행으로 보여줄 수 없어 제외

    if (r.vendor_id && byVendor.has(r.vendor_id)) {
      const row = byVendor.get(r.vendor_id)!
      row.alias_ids.push(r.alias_id)
      row.cum_sales      += r.cum_sales
      row.cum_purchase   += r.cum_purchase
      row.month_sales    += r.month_sales
      row.month_purchase += r.month_purchase
    } else {
      // vendor_id가 없거나(아직 거래처 미연결) vendors 목록(활성 vendor/both)에 없는 alias
      unlinkedRows.push({
        vendor_id: null,
        alias_ids: [r.alias_id],
        name: r.erp_name,
        linked: false,
        unpaid_balance: null,
        cum_sales: r.cum_sales, cum_purchase: r.cum_purchase, cum_profit: r.cum_sales - r.cum_purchase,
        month_sales: r.month_sales, month_purchase: r.month_purchase, month_profit: r.month_sales - r.month_purchase,
      })
    }
  }

  const rows = [...Array.from(byVendor.values()), ...unlinkedRows].map(row => ({
    ...row,
    cum_profit:   row.cum_sales - row.cum_purchase,
    month_profit: row.month_sales - row.month_purchase,
  }))

  rows.sort((a, b) => (b.unpaid_balance ?? -Infinity) - (a.unpaid_balance ?? -Infinity))

  return NextResponse.json({ data: rows })
}
