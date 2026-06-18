import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const DIRECTION_LABEL: Record<string, string> = { sales: '매출', purchase: '매입' }
const TAX_TYPE_LABEL:  Record<string, string> = { taxable: '과세', exempt: '면세' }
const STATUS_LABEL:    Record<string, string> = { matched: '확인됨', unmatched: '미확인' }

// GET /api/tax-invoices/export
// 현재 필터 기준으로 세금계산서 목록을 XLSX로 내보내기
// Query params: direction, taxType, vendorId, paymentStatus, from, to
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction     = searchParams.get('direction')
  const taxType       = searchParams.get('taxType')
  const vendorId      = searchParams.get('vendorId')
  const paymentStatus = searchParams.get('paymentStatus')
  const from          = searchParams.get('from')
  const to            = searchParams.get('to')

  let query = admin
    .from('tax_invoices')
    .select(`
      issue_date, direction, tax_type, counterparty_name, counterparty_biz_number,
      supply_amount, tax_amount, total_amount, item_name, approval_number, payment_status, note,
      matched_transaction:transactions!matched_transaction_id (
        account_alias,
        bank_accounts ( bank_name, account_number, alias )
      )
    `)
    .order('issue_date', { ascending: false })
    .limit(50000)

  if (direction)     query = query.eq('direction', direction)
  if (taxType)       query = query.eq('tax_type', taxType)
  if (vendorId)      query = query.eq('vendor_id', vendorId)
  if (paymentStatus) query = query.eq('payment_status', paymentStatus)
  if (from)          query = query.gte('issue_date', from)
  if (to)            query = query.lte('issue_date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map(r => {
    const tx  = r.matched_transaction as unknown as { account_alias: string | null; bank_accounts: { bank_name: string; account_number: string | null } | null } | null
    const acc = tx?.bank_accounts
    const matchedAccount = acc ? [acc.bank_name, acc.account_number].filter(Boolean).join(' ') : tx?.account_alias ?? ''

    return {
      '작성일자':   r.issue_date,
      '방향':       DIRECTION_LABEL[r.direction]    ?? r.direction,
      '세금유형':   TAX_TYPE_LABEL[r.tax_type]      ?? r.tax_type,
      '거래처명':   r.counterparty_name             ?? '',
      '사업자번호': r.counterparty_biz_number       ?? '',
      '공급가액':   r.supply_amount                 ?? 0,
      '세액':       r.tax_amount                    ?? 0,
      '합계금액':   r.total_amount                  ?? 0,
      '품목':       r.item_name                     ?? '',
      '승인번호':   r.approval_number               ?? '',
      '확인상태':   STATUS_LABEL[r.payment_status]  ?? (r.payment_status ?? ''),
      '매칭계좌':   matchedAccount,
      '메모':       r.note                          ?? '',
    }
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, // 작성일자
    { wch:  6 }, // 방향
    { wch:  8 }, // 세금유형
    { wch: 24 }, // 거래처명
    { wch: 14 }, // 사업자번호
    { wch: 14 }, // 공급가액
    { wch: 12 }, // 세액
    { wch: 14 }, // 합계금액
    { wch: 30 }, // 품목
    { wch: 36 }, // 승인번호
    { wch: 10 }, // 확인상태
    { wch: 26 }, // 매칭계좌
    { wch: 30 }, // 메모
  ]
  const sheetLabel = direction ? `${DIRECTION_LABEL[direction] ?? direction}세금계산서` : '세금계산서'
  XLSX.utils.book_append_sheet(wb, ws, sheetLabel)

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today = new Date().toISOString().slice(0, 10)

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${sheetLabel}_${today}`)}.xlsx`,
    },
  })
}
