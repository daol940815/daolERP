import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TYPE: Record<string, string> = { vendor: '매입처', both: '매출/매입' }

// GET /api/vendors/export — 매입처(거래처 마스터) 목록
export async function GET() {
  const admin = createAdminClient()
  const result = await fetchAllRows<Record<string, unknown>>((f, t) =>
    admin.from('vendors')
      .select('name, biz_number, type, contact_name, contact_phone, email, ledger_balance, note')
      .in('type', ['vendor', 'both']).eq('is_active', true).order('name').range(f, t),
  )
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const rows = result.data.map(v => ({
    '매입처명': v.name, '사업자번호': v.biz_number ?? '', '구분': TYPE[v.type as string] ?? v.type,
    '담당자': v.contact_name ?? '', '연락처': v.contact_phone ?? '', '이메일': v.email ?? '',
    '거래처통보잔액': v.ledger_balance ?? '', '메모': v.note ?? '',
  }))
  return xlsxResponse(rows, '매입처목록', [24, 14, 10, 12, 16, 22, 16, 30])
}
