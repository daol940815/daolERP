import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildReceivableRows } from '@/lib/erp-reports'
import { getPeriodRange } from '@/lib/period-presets'
import type { VendorSalesListRow } from '@/types/vendor-sales'

export const dynamic = 'force-dynamic'

// GET /api/customers/list-summary?staff=
// 매출처 목록 페이지: 매출처(vendors, type=customer|both) + vendor_id가 연결되지 않은 매출 alias를
// 한 화면에 모아 미수금/누적·당월 매출액/담당직원을 보여준다.
// staff 지정 시 해당 직원이 담당자로 기재된 주문만 집계(거래처 자체는 필터링하지 않음).
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const staff = new URL(req.url).searchParams.get('staff')

  const { data: vendors, error: ve } = await admin
    .from('vendors')
    .select('id, name')
    .in('type', ['customer', 'both'])
    .eq('is_active', true)
    .order('name')
  if (ve) return NextResponse.json({ error: ve.message }, { status: 500 })

  const cumResult = await buildReceivableRows(admin, null, null, staff)
  if ('error' in cumResult) return NextResponse.json({ error: cumResult.error }, { status: 500 })

  const { from, to } = getPeriodRange('당월')
  const monthResult = await buildReceivableRows(admin, from, to, staff)
  if ('error' in monthResult) return NextResponse.json({ error: monthResult.error }, { status: 500 })

  const monthSalesByAlias = new Map(monthResult.rows.map(r => [r.alias_id ?? '__none__', r.total_amount]))

  const byVendor = new Map<string, VendorSalesListRow>()
  for (const v of vendors ?? []) {
    byVendor.set(v.id as string, {
      vendor_id: v.id as string,
      alias_ids: [],
      name: v.name as string,
      linked: true,
      outstanding_amount: 0,
      cum_sales: 0,
      month_sales: 0,
      staff_names: [],
    })
  }
  const staffSetByVendor = new Map<string, Set<string>>()

  const unlinkedRows: VendorSalesListRow[] = []

  for (const r of cumResult.rows) {
    if (!r.alias_id) continue // 매출처(alias) 미지정 주문은 거래처 행으로 보여줄 수 없어 제외
    const monthSales = monthSalesByAlias.get(r.alias_id) ?? 0

    if (r.vendor_id && byVendor.has(r.vendor_id)) {
      const row = byVendor.get(r.vendor_id)!
      row.alias_ids.push(r.alias_id)
      row.outstanding_amount += r.outstanding_amount
      row.cum_sales += r.total_amount
      row.month_sales += monthSales
      if (!staffSetByVendor.has(r.vendor_id)) staffSetByVendor.set(r.vendor_id, new Set())
      for (const s of r.staff_names) staffSetByVendor.get(r.vendor_id)!.add(s)
    } else {
      unlinkedRows.push({
        vendor_id: null,
        alias_ids: [r.alias_id],
        name: r.erp_name,
        linked: false,
        outstanding_amount: r.outstanding_amount,
        cum_sales: r.total_amount,
        month_sales: monthSales,
        staff_names: [...r.staff_names],
      })
    }
  }

  for (const [vendorId, set] of Array.from(staffSetByVendor.entries())) {
    byVendor.get(vendorId)!.staff_names = Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'))
  }

  const rows = [...Array.from(byVendor.values()), ...unlinkedRows]
  rows.sort((a, b) => b.outstanding_amount - a.outstanding_amount || b.cum_sales - a.cum_sales)

  return NextResponse.json({ data: rows, staff_names: cumResult.staffNames })
}
