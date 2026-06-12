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
  const nameLabel = isSales ? 'ERP 매출처' : 'ERP 매입처'
  const erpLabel  = isSales ? 'ERP 순매출' : 'ERP 매입'
  const bankLabel = isSales ? '은행 입금' : '은행 출금'

  // member 행은 결제가 거래처 합계 행에만 있으므로 결제 칸을 비워둔다
  const sheetRows = result.rows.map(r => {
    const pay = r.has_payment
    return {
      [nameLabel]:       r.kind === 'subtotal' ? `${r.erp_name} 합계` : r.erp_name,
      '연결 거래처':     r.kind === 'subtotal' ? '' : (r.vendor_name ?? '(미연결)'),
      [erpLabel]:        r.erp_amount,
      ...(isSales ? { 'ERP 미수금': r.erp_outstanding } : {}),
      [bankLabel]:       pay ? r.bank_amount : null,
      ...(isSales ? { '카드매출': pay ? r.card_amount : null } : {}),
      '현금영수증':      pay ? r.cash_amount : null,
      '결제 합계':       pay ? r.payment_total : null,
      '차액(ERP−결제)':  pay ? r.diff_payment : null,
      '세금계산서':      pay ? r.invoice_amount : null,
      '차액(ERP−계산서)': pay ? r.diff_invoice : null,
    }
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows)
  ws['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 15 }]
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
