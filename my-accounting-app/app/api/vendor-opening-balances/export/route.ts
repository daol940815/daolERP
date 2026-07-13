import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/vendor-opening-balances/export — 거래처별 기초잔액(미수/미지급)
export async function GET() {
  const admin = createAdminClient()
  const { data: bal, error } = await admin.from('vendor_opening_balances').select('vendor_id, amount, note, as_of_date')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (bal ?? []).map(b => b.vendor_id)
  const nameMap = new Map<string, string>()
  if (ids.length) {
    const { data: vs } = await admin.from('vendors').select('id, name').in('id', ids)
    for (const v of vs ?? []) nameMap.set(v.id as string, v.name as string)
  }
  const rows = (bal ?? []).map(b => ({
    '거래처': nameMap.get(b.vendor_id) ?? '',
    '구분': (b.amount as number) < 0 ? '미지급(채무)' : '미수(채권)',
    '금액': Math.abs(b.amount as number),
    '기준일': b.as_of_date ?? '',
    '비고': b.note ?? '',
  }))
  return xlsxResponse(rows, '기초잔액_거래처', [28, 14, 16, 12, 20])
}
