import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildErpSpecialData } from '@/lib/erp-special'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/reports/erp-special/export?from=&to=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const result = await buildErpSpecialData(admin, searchParams.get('from'), searchParams.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const wb = XLSX.utils.book_new()

  const vipRows = result.vip_items.map(r => ({
    '주문일':   r.order_date ?? '',
    '주문번호': r.order_no,
    '매출처':   r.customer_name,
    '품명':     r.item_name ?? '',
    '판매가':   r.sale_price,
    '수량':     r.quantity,
    '합계':     r.line_total,
    '취소':     r.is_canceled ? '취소' : '',
  }))
  vipRows.push({
    '주문일': '합계', '주문번호': '', '매출처': '', '품명': '',
    '판매가': 0, '수량': 0,
    '합계': result.vip_items.filter(r => !r.is_canceled).reduce((s, r) => s + r.line_total, 0),
    '취소': '',
  })
  const wsVip = XLSX.utils.json_to_sheet(vipRows)
  wsVip['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 30 }, { wch: 12 }, { wch: 7 }, { wch: 12 }, { wch: 7 }]
  XLSX.utils.book_append_sheet(wb, wsVip, 'VIP_품목내역')

  const ledgerRows = result.ledger.map(r => ({
    '일자':   r.entry_date,
    '매출처': r.customer_name,
    '구분':   r.entry_type === 'deposit' ? '입금' : '차감',
    '금액':   r.amount,
    '메모':   r.memo ?? '',
  }))
  const wsLedger = XLSX.utils.json_to_sheet(ledgerRows)
  wsLedger['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 13 }, { wch: 36 }]
  XLSX.utils.book_append_sheet(wb, wsLedger, '선결제_원장')

  const balRows = result.balances.map(r => ({
    '매출처':   r.customer_name,
    '입금합계': r.deposit_total,
    '차감합계': r.deduction_total,
    '잔액':     r.balance,
  }))
  balRows.push({
    '매출처':   '합계',
    '입금합계': result.balances.reduce((s, r) => s + r.deposit_total, 0),
    '차감합계': result.balances.reduce((s, r) => s + r.deduction_total, 0),
    '잔액':     result.balances.reduce((s, r) => s + r.balance, 0),
  })
  const wsBal = XLSX.utils.json_to_sheet(balRows)
  wsBal['!cols'] = [{ wch: 24 }, { wch: 13 }, { wch: 13 }, { wch: 13 }]
  XLSX.utils.book_append_sheet(wb, wsBal, '선결제_잔액')

  const buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today    = new Date().toISOString().slice(0, 10)
  const filename = `ERP_VIP_선결제_${today}`

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`,
    },
  })
}
