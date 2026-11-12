import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildMonthlyPL } from '@/lib/pl-report'
import { xlsxResponseMulti } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/monthly-pl/export?from=YYYY-MM&to=YYYY-MM
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from'); const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from·to(YYYY-MM)가 필요합니다.' }, { status: 400 })

  const basis = searchParams.get('basis') === 'erp' ? 'erp' : 'evidence'
  const result = await buildMonthlyPL(admin, from, to, basis)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const { months, items, reconcile, taxSplit } = result.result

  const rows = items.map(it => {
    const row: Record<string, unknown> = { '항목': it.is_section_header ? `[${it.label}]` : it.label }
    months.forEach((m, i) => { row[m] = it.is_section_header ? '' : (it.values[i] ?? 0) })
    row['합계'] = it.is_section_header ? '' : it.values.reduce((s, v) => s + (v ?? 0), 0)
    return row
  })
  const cols = [34, ...months.map(() => 14), 14]
  const sheets: { name: string; rows: Record<string, unknown>[]; cols?: number[] }[] = [
    { name: basis === 'evidence' ? '손익(증빙기준)' : '손익(ERP기준)', rows, cols },
  ]
  if (taxSplit) {
    const tsRows: Record<string, unknown>[] = []
    for (const [title, r] of [['과세', taxSplit.taxable], ['면세', taxSplit.exempt], ['구분 없음', taxSplit.other]] as const) {
      for (const [label, arr] of [['매출', r.revenue], ['매출원가', r.cogs], ['매출이익', r.gross]] as const) {
        const row: Record<string, unknown> = { '항목': `${title} ${label}` }
        months.forEach((m, i) => { row[m] = arr[i] })
        row['합계'] = arr.reduce((s, v) => s + v, 0)
        tsRows.push(row)
      }
    }
    sheets.push({ name: '과세면세별 매출이익', rows: tsRows, cols })
  }
  if (reconcile) {
    const recRows: Record<string, unknown>[] = []
    for (const [label, arr] of [['매출 (증빙 기준)', reconcile.evidence], ['매출 (ERP 기준)', reconcile.erp], ['차이 (ERP − 증빙)', reconcile.diff]] as const) {
      const row: Record<string, unknown> = { '항목': label }
      months.forEach((m, i) => { row[m] = arr[i] })
      row['합계'] = arr.reduce((s, v) => s + v, 0)
      recRows.push(row)
    }
    sheets.push({ name: '매출대사(월)', rows: recRows, cols })
    sheets.push({
      name: '매출대사(거래처)',
      rows: reconcile.vendors.map(v => ({
        '거래처': v.vendor_name, 'ERP 순매출': v.erp, '증빙 매출': v.evidence, '차이 (ERP−증빙)': v.diff,
        'ERP 주문수': v.erp_orders, '계산서 수': v.invoices,
      })),
      cols: [30, 14, 14, 14, 10, 10],
    })
  }
  return xlsxResponseMulti(sheets, '월별손익현황')
}
