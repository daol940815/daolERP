import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPayableRows } from '@/lib/erp-reports'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const TERM_LABEL: Record<string, string> = { advance: '선입금', monthly: '월말정산' }

// GET /api/reports/erp-payables/export?monthFrom=&monthTo=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildPayableRows(admin, searchParams.get('monthFrom'), searchParams.get('monthTo'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const sheetRows = result.rows.map(r => ({
    '정산월':       r.settlement_month,
    '매입처(ERP)':  r.erp_name,
    '연결 거래처':  r.vendor_name ?? '',
    '결제방식':     TERM_LABEL[r.payment_term] ?? r.payment_term,
    '품목수':       r.item_count,
    '매입액':       r.purchase_total,
    '상태':         r.status === 'paid' ? '결제완료' : '미결제',
    '결제일':       r.paid_date ?? '',
    '실제결제액':   r.paid_amount ?? '',
    '차액':         r.paid_amount != null ? r.paid_amount - r.purchase_total : '',
    '선입금잔액':   r.prepay_balance,
    '메모':         r.settlement_memo ?? '',
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows)
  ws['!cols'] = [{ wch: 9 }, { wch: 24 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 13 }, { wch: 9 }, { wch: 11 }, { wch: 13 }, { wch: 11 }, { wch: 12 }, { wch: 24 }]
  XLSX.utils.book_append_sheet(wb, ws, 'ERP_매입처_결제현황')

  const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today    = new Date().toISOString().slice(0, 10)
  const filename = `ERP_매입처_결제현황_${today}`

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`,
    },
  })
}
