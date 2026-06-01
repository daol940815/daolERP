import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

const VALID_TYPES = ['income', 'expense', 'asset', 'liability', 'equity']
const VALID_SIDES = ['debit', 'credit']
const ACCOUNT_FIELDS = 'id, name, code, type, keywords, is_active, side_on_in, side_on_out'

// POST /api/accounts/bulk — 계정과목 일괄 upsert (code 기준)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json() as {
    accounts: Array<{
      code:         string
      name:         string
      type:         string
      keywords:     string[]
      is_active:    boolean
      side_on_in?:  string
      side_on_out?: string
    }>
  }

  const { accounts } = body
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json({ error: '계정과목 데이터가 없습니다.' }, { status: 400 })
  }

  for (const a of accounts) {
    if (!a.code?.trim() || !a.name?.trim()) {
      return NextResponse.json(
        { error: `코드와 이름은 필수입니다. (코드: "${a.code}", 이름: "${a.name}")` },
        { status: 400 },
      )
    }
    if (!VALID_TYPES.includes(a.type)) {
      return NextResponse.json(
        { error: `유효하지 않은 유형: "${a.type}" — 수익/비용/자산/부채/자본 중 하나여야 합니다. (코드: ${a.code})` },
        { status: 400 },
      )
    }
    if (a.side_on_in  && !VALID_SIDES.includes(a.side_on_in)) {
      return NextResponse.json(
        { error: `유효하지 않은 입금시 방향: "${a.side_on_in}" (코드: ${a.code})` },
        { status: 400 },
      )
    }
    if (a.side_on_out && !VALID_SIDES.includes(a.side_on_out)) {
      return NextResponse.json(
        { error: `유효하지 않은 출금시 방향: "${a.side_on_out}" (코드: ${a.code})` },
        { status: 400 },
      )
    }
  }

  const rows = accounts.map(a => {
    const row: Record<string, unknown> = {
      code:     a.code.trim(),
      name:     a.name.trim(),
      type:     a.type,
      keywords: Array.isArray(a.keywords) ? a.keywords : [],
      is_active: a.is_active,
    }
    if (a.side_on_in)  row.side_on_in  = a.side_on_in
    if (a.side_on_out) row.side_on_out = a.side_on_out
    return row
  })

  const { data, error } = await admin
    .from('accounts')
    .upsert(rows, { onConflict: 'code' })
    .select(ACCOUNT_FIELDS)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [], count: data?.length ?? 0 })
}
