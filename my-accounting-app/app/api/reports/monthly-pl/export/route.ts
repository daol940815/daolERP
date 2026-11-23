import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildMonthlyPL } from '@/lib/pl-report'
import { xlsxResponseMulti } from '@/lib/xlsx-export'
import { stockListAt } from '@/lib/stock'
import { supplyOfStock } from '@/lib/stock-cost'

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
    row['합계'] = it.is_section_header || it.no_total ? '' : it.values.reduce((s, v) => s + (v ?? 0), 0)
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
  // 연말 재고 (1400): 기간에 12월이 있으면 그해 12월 말 품목별 선매입 재고 — 세무사에게 넘길 기말 재고자산(내부 확인용)
  const yearEnds = months.filter(m => m.endsWith('-12')).map(m => `${m}-31`)
  if (yearEnds.length) {
    const list = await stockListAt(admin, yearEnds)
    if (!('error' in list)) {
      const pids = Array.from(new Set(Array.from(list.data.values()).flat().map(r => r.product_id)))
      const names = new Map<string, { item_code: string | null; item_name: string; purchase_vendor_name: string | null }>()
      for (let i = 0; i < pids.length; i += 150) {
        const { data } = await admin.from('erp_products').select('id, item_code, item_name, purchase_vendor_name').in('id', pids.slice(i, i + 150))
        for (const p of data ?? []) names.set(p.id as string, p as { item_code: string | null; item_name: string; purchase_vendor_name: string | null })
      }
      for (const d of yearEnds) {
        const rows = (list.data.get(d) ?? []).map(r => {
          const n = names.get(r.product_id)
          return { '품번': n?.item_code ?? '', '품명': n?.item_name ?? '', '매입처': n?.purchase_vendor_name ?? '', '재고 수량': r.qty,
            '재고 금액(부가세 포함)': r.amount, '공급가액(÷1.1)': supplyOfStock(r.amount) }
        }).sort((a, b) => String(a['품명']).localeCompare(String(b['품명']), 'ko'))
        if (rows.length) {
          rows.push({ '품번': '', '품명': '합계', '매입처': '', '재고 수량': rows.reduce((s, r) => s + r['재고 수량'], 0),
            '재고 금액(부가세 포함)': rows.reduce((s, r) => s + r['재고 금액(부가세 포함)'], 0), '공급가액(÷1.1)': rows.reduce((s, r) => s + r['공급가액(÷1.1)'], 0) })
          sheets.push({ name: `연말 재고 ${d.slice(0, 4)}`, rows, cols: [14, 34, 18, 10, 16, 16] })
        }
      }
    }
  }
  return xlsxResponseMulti(sheets, '월별손익현황')
}
