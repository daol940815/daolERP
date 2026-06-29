import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TYPE_LABEL: Record<string, string> = { asset: '자산', liability: '부채', equity: '자본' }

// GET /api/opening-balances/export — 계정별 기초잔액(영구계정)
export async function GET() {
  const admin = createAdminClient()
  const { data: accounts, error: ae } = await admin
    .from('accounts').select('id, code, name, type')
    .in('type', ['asset', 'liability', 'equity']).eq('is_active', true).order('code')
  if (ae) return NextResponse.json({ error: ae.message }, { status: 500 })
  const { data: bal } = await admin.from('account_opening_balances').select('account_id, amount, source, as_of_date')
  const map = new Map((bal ?? []).map(b => [b.account_id, b]))

  const rows = (accounts ?? []).map(a => {
    const b = map.get(a.id)
    return {
      '코드': a.code ?? '', '계정과목': a.name, '유형': TYPE_LABEL[a.type] ?? a.type,
      '기초잔액': b?.amount ?? 0, '구분': b ? (b.source === 'auto_bank' ? '자동' : '수기') : '',
      '기준일': b?.as_of_date ?? '',
    }
  })
  return xlsxResponse(rows, '기초잔액_계정', [10, 18, 8, 16, 8, 12])
}
