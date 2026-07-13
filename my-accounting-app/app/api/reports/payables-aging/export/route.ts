import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPayableAgingRows } from '@/lib/erp-reports'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/payables-aging/export?asOf=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const result = await buildPayableAgingRows(admin, new URL(req.url).searchParams.get('asOf'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const rows = result.rows.map(r => ({
    '매입처': r.erp_name, '거래처': r.vendor_name ?? '',
    '30일이내': r.bucket_30, '31~60일': r.bucket_60, '61~90일': r.bucket_90, '90일초과': r.bucket_over,
    '미지급합계': r.total,
  }))
  return xlsxResponse(rows, `미지급금Aging_${result.as_of}`, [24, 20, 14, 14, 14, 14, 16])
}
