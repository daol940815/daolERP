import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = { approval: '승인', cancel: '취소' }

// GET /api/card-sales/export
// 현재 필터 기준으로 카드결제내역을 XLSX로 내보내기
// Query params: from, to, vendorId, type, unmatched
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from      = searchParams.get('from')
  const to        = searchParams.get('to')
  const vendorId  = searchParams.get('vendorId')
  const type      = searchParams.get('type')
  const unmatched = searchParams.get('unmatched')

  let query = admin
    .from('card_sales')
    .select('tx_date, tx_time, transaction_type, approval_number, card_number, acquirer, amount, supply_amount, tax_amount, processing_status, deposit_expected_date, cancelled_at, settlement_status, note, vendors(name)')
    .order('tx_date', { ascending: false })
    .limit(50000)

  if (from)                 query = query.gte('tx_date', from)
  if (to)                   query = query.lte('tx_date', to)
  if (vendorId)             query = query.eq('vendor_id', vendorId)
  if (type && type !== 'all') query = query.eq('transaction_type', type)
  if (unmatched === 'true') query = query.is('vendor_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map(r => ({
    '거래일자':   r.tx_date,
    '거래시간':   r.tx_time ?? '',
    '유형':       TYPE_LABEL[r.transaction_type] ?? r.transaction_type,
    '승인번호':   r.approval_number,
    '카드번호':   r.card_number ?? '',
    '매입사':     r.acquirer ?? '',
    '결제금액':   r.amount,
    '공급가액':   r.supply_amount ?? 0,
    '세액':       r.tax_amount ?? 0,
    '처리현황':   r.processing_status ?? '',
    '정산상태':   r.settlement_status ?? '',
    '입금예정일': r.deposit_expected_date ?? '',
    '취소일시':   r.cancelled_at ?? '',
    '거래처':     (r.vendors as { name?: string } | null)?.name ?? '',
    '메모':       r.note ?? '',
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, // 거래일자
    { wch: 10 }, // 거래시간
    { wch:  6 }, // 유형
    { wch: 14 }, // 승인번호
    { wch: 22 }, // 카드번호
    { wch: 14 }, // 매입사
    { wch: 14 }, // 결제금액
    { wch: 14 }, // 공급가액
    { wch: 12 }, // 세액
    { wch: 16 }, // 처리현황
    { wch: 20 }, // 정산상태
    { wch: 12 }, // 입금예정일
    { wch: 20 }, // 취소일시
    { wch: 24 }, // 거래처
    { wch: 30 }, // 메모
  ]
  XLSX.utils.book_append_sheet(wb, ws, '카드결제내역')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today = new Date().toISOString().slice(0, 10)

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`카드결제내역_${today}`)}.xlsx`,
    },
  })
}
