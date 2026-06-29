import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/ledger/vendor/export?from=&to=          → 잔액탭(거래처별 요약)
// GET /api/ledger/vendor/export?vendorId=&from=&to= → 내용탭(거래처 상세)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const vendorId = searchParams.get('vendorId'); const from = searchParams.get('from'); const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from·to가 필요합니다.' }, { status: 400 })

  if (!vendorId) {
    const { data, error } = await admin.rpc('vendor_ledger_balances', { p_from: from, p_to: to })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data as { vendor_name: string; opening: number; period_debit: number; period_credit: number; closing: number }[] ?? []).map(b => ({
      '거래처': b.vendor_name, '전월이월': b.opening, '차변': b.period_debit || '', '대변': b.period_credit || '', '잔액': b.closing,
    }))
    return xlsxResponse(rows, '거래처별원장_잔액', [28, 16, 14, 14, 16])
  }

  const { data, error } = await admin.rpc('vendor_ledger_detail', { p_vendor_id: vendorId, p_from: from, p_to: to })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const d = data as {
    vendor: { name: string }; opening: number; total_debit: number; total_credit: number; closing: number
    rows: { entry_date: string; entry_no: string; description: string | null; account_code: string | null; account_name: string | null; debit: number; credit: number; balance: number }[]
  }
  if (!d?.vendor) return NextResponse.json({ error: '거래처를 찾을 수 없습니다.' }, { status: 404 })

  const rows: Record<string, unknown>[] = []
  rows.push({ '일자': '', '전표번호': '', '적요': '[전월이월]', '계정과목': '', '차변': '', '대변': '', '잔액': d.opening })
  for (const r of d.rows) {
    rows.push({
      '일자': r.entry_date, '전표번호': r.entry_no, '적요': r.description ?? '',
      '계정과목': `${r.account_code ?? ''} ${r.account_name ?? ''}`.trim(),
      '차변': r.debit || '', '대변': r.credit || '', '잔액': r.balance,
    })
  }
  rows.push({ '일자': '', '전표번호': '', '적요': '[누계]', '계정과목': '', '차변': d.total_debit, '대변': d.total_credit, '잔액': d.closing })
  return xlsxResponse(rows, `거래처별원장_${d.vendor.name}`, [12, 18, 30, 20, 14, 14, 16])
}
