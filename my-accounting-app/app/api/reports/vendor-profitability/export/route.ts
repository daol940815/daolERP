import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVendorAnalysisRows } from '@/lib/vendor-analysis'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/vendor-profitability/export?from=&to=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const result = await buildVendorAnalysisRows(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const rows = result.rows.map(r => ({
    '매출처': r.erp_name, '거래처': r.vendor_name ?? '',
    '주문수': r.order_count, '품목수': r.item_count, '수량': r.quantity,
    '순매출': r.sales_amount, '매입원가': r.purchase_amount, '매출이익': r.profit_amount,
    '이익률(%)': Math.round(r.profit_rate * 10) / 10,
  }))
  return xlsxResponse(rows, '거래처별수익성', [24, 20, 10, 10, 10, 16, 16, 16, 12])
}
