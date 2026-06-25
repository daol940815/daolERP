import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending:   '미검토',
  reviewed:  '검토완료',
  confirmed: '확정',
}

// GET /api/transactions/export
// 현재 필터 기준으로 전체 거래내역을 XLSX로 내보내기
// Query params: status, source, from, to, bankAccountId, vendorId
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const status        = searchParams.get('status')
  const source        = searchParams.get('source')
  const from          = searchParams.get('from')
  const to            = searchParams.get('to')
  const bankAccountId = searchParams.get('bankAccountId')
  const vendorId      = searchParams.get('vendorId')

  const txsResult = await fetchAllRows<Record<string, unknown>>((rFrom, rTo) => {
    let query = admin
      .from('transactions')
      .select('tx_date, tx_time, description, counterparty_name, amount_in, amount_out, balance, account_alias, status, confirmed_account_id, memo, vendors(name)')
      .order('tx_date', { ascending: false })
      .order('tx_time', { ascending: false, nullsFirst: false })
    if (status && status !== 'all') query = query.eq('status', status)
    if (source && source !== 'all') query = query.eq('source', source)
    if (from)          query = query.gte('tx_date', from)
    if (to)            query = query.lte('tx_date', to)
    if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
    if (vendorId)      query = query.eq('vendor_id', vendorId)
    return query.range(rFrom, rTo)
  })
  if ('error' in txsResult) return NextResponse.json({ error: txsResult.error }, { status: 500 })
  const txs = txsResult.data

  const { data: accounts } = await admin.from('accounts').select('id, name')
  const acctMap = Object.fromEntries((accounts ?? []).map(a => [a.id, a.name as string]))

  const rows = txs.map(r => ({
    '거래일자':  (r.tx_date as string).slice(0, 10),
    '내용/적요': r.description ?? '',
    '거래처':    (r.vendors as { name?: string } | null)?.name ?? (r.counterparty_name ?? ''),
    '입금액':    r.amount_in  ?? '',
    '출금액':    r.amount_out ?? '',
    '잔액':      r.balance    ?? '',
    '계좌':      r.account_alias ?? '',
    '상태':      STATUS_LABEL[r.status as string] ?? (r.status ?? ''),
    '계정과목':  r.confirmed_account_id ? (acctMap[r.confirmed_account_id as string] ?? '') : '',
    '메모':      r.memo ?? '',
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, // 거래일자
    { wch: 40 }, // 내용/적요
    { wch: 24 }, // 거래처
    { wch: 14 }, // 입금액
    { wch: 14 }, // 출금액
    { wch: 14 }, // 잔액
    { wch: 20 }, // 계좌
    { wch: 10 }, // 상태
    { wch: 22 }, // 계정과목
    { wch: 30 }, // 메모
  ]
  XLSX.utils.book_append_sheet(wb, ws, '계좌거래내역')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today = new Date().toISOString().slice(0, 10)

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`계좌거래내역_${today}`)}.xlsx`,
    },
  })
}
