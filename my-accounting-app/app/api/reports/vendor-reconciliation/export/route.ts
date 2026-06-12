import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildReconciliationRows } from '@/lib/vendor-reconciliation'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

// GET /api/reports/vendor-reconciliation/export?direction=sales|purchase&from=&to=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction = searchParams.get('direction') === 'purchase' ? 'purchase' : 'sales'
  const result = await buildReconciliationRows(
    admin, direction, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const isSales = direction === 'sales'
  const erpLabel  = isSales ? 'ERP 순매출' : 'ERP 매입'
  const bankLabel = isSales ? '은행 입금' : '은행 출금'

  const sheetRows = result.rows.map(r => ({
    '거래처':          r.vendor_name,
    [erpLabel]:        r.erp_amount,
    ...(isSales ? { 'ERP 미수금': r.erp_outstanding } : {}),
    [bankLabel]:       r.bank_amount,
    ...(isSales ? { '카드매출': r.card_amount } : {}),
    '현금영수증':      r.cash_amount,
    '결제 합계':       r.payment_total,
    '차액(ERP−결제)':  r.diff_payment,
    '세금계산서':      r.invoice_amount,
    '차액(ERP−계산서)': r.diff_invoice,
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows)
  ws['!cols'] = [{ wch: 24 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 15 }]
  XLSX.utils.book_append_sheet(wb, ws, isSales ? '매출_대조' : '매입_대조')

  const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today    = new Date().toISOString().slice(0, 10)
  const filename = `거래처_정산대조_${isSales ? '매출' : '매입'}_${today}`

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`,
    },
  })
}
