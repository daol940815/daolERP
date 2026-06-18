import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

// GET /api/transactions/export-unclassified
// 미분류 거래를 XLSX로 내보내기 (현재 필터 기준)
// Query params: from, to, bankAccountId
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from          = searchParams.get('from')
  const to            = searchParams.get('to')
  const bankAccountId = searchParams.get('bankAccountId')

  // 미분류 거래 조회 (confirmed_account_id 없음 + pending/reviewed 상태)
  let query = admin
    .from('transactions')
    .select('id, tx_date, description, amount_in, amount_out, balance, account_alias, memo, suggested_account_id')
    .is('confirmed_account_id', null)
    .in('status', ['pending', 'reviewed'])
    .order('tx_date', { ascending: false })
    .order('tx_time', { ascending: false, nullsFirst: false })
    .limit(10000)

  if (from)          query = query.gte('tx_date', from)
  if (to)            query = query.lte('tx_date', to)
  if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)

  const [{ data: txs, error }, { data: accounts }] = await Promise.all([
    query,
    admin.from('accounts').select('id, name, code').order('code'),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const acctMap = Object.fromEntries((accounts ?? []).map(a => [a.id, a.name]))

  // Sheet 1: 미분류 거래 내역 (계정과목 빈칸)
  const rows = (txs ?? []).map(tx => ({
    'id':              tx.id,
    '거래일자':         (tx.tx_date as string).slice(0, 10),
    '내용/적요':        tx.description ?? '',
    '입금액':           tx.amount_in  ?? '',
    '출금액':           tx.amount_out ?? '',
    '잔액':             tx.balance    ?? '',
    '계좌':             tx.account_alias ?? '',
    'AI추천 계정과목':  tx.suggested_account_id ? (acctMap[tx.suggested_account_id] ?? '') : '',
    '계정과목':         '',   // ← 사용자가 여기에 입력
    '메모':             tx.memo ?? '',
  }))

  const wb = XLSX.utils.book_new()

  const ws1 = XLSX.utils.json_to_sheet(rows)
  ws1['!cols'] = [
    { wch: 38 }, // id
    { wch: 12 }, // 거래일자
    { wch: 40 }, // 내용/적요
    { wch: 14 }, // 입금액
    { wch: 14 }, // 출금액
    { wch: 14 }, // 잔액
    { wch: 20 }, // 계좌
    { wch: 22 }, // AI추천
    { wch: 22 }, // 계정과목
    { wch: 30 }, // 메모
  ]
  XLSX.utils.book_append_sheet(wb, ws1, '미분류 거래내역')

  // Sheet 2: 계정과목 목록 (참조용)
  const acctRows = (accounts ?? []).map(a => ({ '코드': a.code, '계정과목명': a.name }))
  const ws2 = XLSX.utils.json_to_sheet(acctRows)
  ws2['!cols'] = [{ wch: 12 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, ws2, '계정과목 목록')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array

  const today = new Date().toISOString().slice(0, 10)
  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`미분류거래_${today}`)}.xlsx`,
    },
  })
}
