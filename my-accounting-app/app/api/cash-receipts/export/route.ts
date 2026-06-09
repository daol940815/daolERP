import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = { approval: '승인', cancel: '취소' }
const DIR_LABEL:  Record<string, string> = { sales: '발행(매출)', purchase: '수취(매입)' }

// GET /api/cash-receipts/export
// Query params: direction, from, to, type, unmatched
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction = searchParams.get('direction')
  const from      = searchParams.get('from')
  const to        = searchParams.get('to')
  const type      = searchParams.get('type')
  const unmatched = searchParams.get('unmatched')

  let query = admin
    .from('cash_receipts')
    .select('tx_date, tx_time, direction, transaction_type, approval_number, counterparty_name, counterparty_biz_number, issue_type, purpose_type, deductible, amount, supply_amount, tax_amount, service_charge, note, vendors(name)')
    .order('tx_date', { ascending: false })
    .limit(50000)

  if (direction)              query = query.eq('direction', direction)
  if (from)                   query = query.gte('tx_date', from)
  if (to)                     query = query.lte('tx_date', to)
  if (type && type !== 'all') query = query.eq('transaction_type', type)
  if (unmatched === 'true')   query = query.is('vendor_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const isPurchase = direction === 'purchase'

  const rows = isPurchase
    ? (data ?? []).map(r => ({
        '거래일자':   r.tx_date,
        '거래시간':   r.tx_time    ?? '',
        '유형':       TYPE_LABEL[r.transaction_type] ?? r.transaction_type,
        '승인번호':   r.approval_number,
        '가맹점명':   r.counterparty_name       ?? '',
        '사업자번호': r.counterparty_biz_number  ?? '',
        '공급가액':   r.supply_amount  ?? 0,
        '부가세':     r.tax_amount     ?? 0,
        '봉사료':     r.service_charge ?? 0,
        '매입금액':   r.amount,
        '공제여부':   r.deductible === true ? '공제' : r.deductible === false ? '불공제' : '',
        '거래처':     (r.vendors as { name?: string } | null)?.name ?? '',
        '메모':       r.note ?? '',
      }))
    : (data ?? []).map(r => ({
        '거래일자':   r.tx_date,
        '거래시간':   r.tx_time    ?? '',
        '유형':       TYPE_LABEL[r.transaction_type] ?? r.transaction_type,
        '승인번호':   r.approval_number,
        '발행구분':   r.issue_type   ?? '',
        '용도구분':   r.purpose_type ?? '',
        '공급가액':   r.supply_amount  ?? 0,
        '부가세':     r.tax_amount     ?? 0,
        '봉사료':     r.service_charge ?? 0,
        '총금액':     r.amount,
        '메모':       r.note ?? '',
      }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = isPurchase
    ? [{ wch:12 },{ wch:10 },{ wch:6 },{ wch:14 },{ wch:24 },{ wch:14 },{ wch:14 },{ wch:12 },{ wch:10 },{ wch:14 },{ wch:8 },{ wch:24 },{ wch:30 }]
    : [{ wch:12 },{ wch:10 },{ wch:6 },{ wch:14 },{ wch:10 },{ wch:20 },{ wch:14 },{ wch:12 },{ wch:10 },{ wch:14 },{ wch:30 }]

  const dirLabel  = direction ? (DIR_LABEL[direction] ?? direction) : '전체'
  const sheetName = `현금영수증_${dirLabel}`.slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  const buf     = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today   = new Date().toISOString().slice(0, 10)
  const filename = `현금영수증_${dirLabel}_${today}`

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`,
    },
  })
}
