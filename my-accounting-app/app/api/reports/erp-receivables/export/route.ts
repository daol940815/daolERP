import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildReceivableRows } from '@/lib/erp-reports'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

// GET /api/reports/erp-receivables/export?from=&to=&staff=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const staff  = searchParams.get('staff')
  const result = await buildReceivableRows(admin, searchParams.get('from'), searchParams.get('to'), staff)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const sheetRows = result.rows.map(r => ({
    '매출처(ERP)':  r.erp_name,
    '연결 거래처':  r.vendor_name ?? '',
    '담당직원':     r.staff_names.join(', '),
    '주문건수':     r.order_count,
    '순매출':       r.total_amount,
    'VIP·선결제':   r.excluded_amount,
    '미수금':       r.outstanding_amount,
    '미수건수':     r.outstanding_count,
    '선결제잔액':   r.prepay_balance,
  }))
  sheetRows.push({
    '매출처(ERP)':  '합계',
    '연결 거래처':  '',
    '담당직원':     '',
    '주문건수':     result.rows.reduce((s, r) => s + r.order_count, 0),
    '순매출':       result.rows.reduce((s, r) => s + r.total_amount, 0),
    'VIP·선결제':   result.rows.reduce((s, r) => s + r.excluded_amount, 0),
    '미수금':       result.rows.reduce((s, r) => s + r.outstanding_amount, 0),
    '미수건수':     result.rows.reduce((s, r) => s + r.outstanding_count, 0),
    '선결제잔액':   result.rows.reduce((s, r) => s + r.prepay_balance, 0),
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows)
  ws['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 14 }, { wch: 9 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 9 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws, 'ERP_매출처_미수금현황')

  const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today    = new Date().toISOString().slice(0, 10)
  const filename = `ERP_매출처_미수금현황${staff ? `_${staff}` : ''}_${today}`

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`,
    },
  })
}
