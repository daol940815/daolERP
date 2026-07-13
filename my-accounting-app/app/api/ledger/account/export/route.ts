import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/ledger/account/export?accountId=&from=&to=
// 계정별 원장: 전월이월 + 라인별 차변/대변/잔액 + 누계.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('accountId'); const from = searchParams.get('from'); const to = searchParams.get('to')
  if (!accountId || !from || !to) return NextResponse.json({ error: 'accountId·from·to가 필요합니다.' }, { status: 400 })

  const { data, error } = await admin.rpc('account_ledger', { p_account_id: accountId, p_from: from, p_to: to })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const d = data as {
    account: { code: string | null; name: string }
    opening: number; total_debit: number; total_credit: number; closing: number
    rows: { entry_date: string; entry_no: string; description: string | null; counterpart: string | null; vendor: string | null; debit: number; credit: number; balance: number }[]
  }
  if (!d?.account) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 })

  const rows: Record<string, unknown>[] = []
  rows.push({ '일자': '', '전표번호': '', '적요': '[전월이월]', '상대계정': '', '거래처': '', '차변': '', '대변': '', '잔액': d.opening })
  for (const r of d.rows) {
    rows.push({
      '일자': r.entry_date, '전표번호': r.entry_no, '적요': r.description ?? '',
      '상대계정': r.counterpart ?? '', '거래처': r.vendor ?? '',
      '차변': r.debit || '', '대변': r.credit || '', '잔액': r.balance,
    })
  }
  rows.push({ '일자': '', '전표번호': '', '적요': '[누계]', '상대계정': '', '거래처': '', '차변': d.total_debit, '대변': d.total_credit, '잔액': d.closing })

  const label = `${d.account.code ?? ''} ${d.account.name}`.trim()
  return xlsxResponse(rows, `계정별원장_${label}`, [12, 18, 30, 18, 18, 14, 14, 16])
}
