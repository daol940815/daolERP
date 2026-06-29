import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVatEstimate } from '@/lib/vat-report'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/vat-estimate/export?from=&to=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from'); const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from·to가 필요합니다.' }, { status: 400 })

  const result = await buildVatEstimate(admin, from, to)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const r = result.result

  const rows: Record<string, unknown>[] = []
  rows.push({ '구분': '【요약】', '항목': `${r.from} ~ ${r.to}`, '금액': '' })
  rows.push({ '구분': '매출세액', '항목': '', '금액': r.sales_tax })
  rows.push({ '구분': '매입세액', '항목': '', '금액': r.purchase_tax })
  rows.push({ '구분': '예상부가세', '항목': r.estimated_vat >= 0 ? '납부예상' : '환급예상', '금액': r.estimated_vat })
  rows.push({ '구분': '', '항목': '', '금액': '' })
  rows.push({ '구분': '【매출세액 내역】', '항목': '', '금액': '' })
  for (const b of r.sales_breakdown) rows.push({ '구분': '', '항목': b.label, '금액': b.amount })
  rows.push({ '구분': '', '항목': '', '금액': '' })
  rows.push({ '구분': '【매입세액 내역】', '항목': '', '금액': '' })
  for (const b of r.purchase_breakdown) rows.push({ '구분': '', '항목': b.label, '금액': b.amount })

  return xlsxResponse(rows, '예상부가세', [18, 24, 16])
}
