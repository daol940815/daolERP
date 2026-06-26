import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/opening-balances
// 영구계정(자산·부채·자본) 목록 + 기초잔액(있으면). 손익(수익·비용)은 제외.
export async function GET() {
  const admin = createAdminClient()

  const { data: accounts, error: ae } = await admin
    .from('accounts')
    .select('id, code, name, type')
    .in('type', ['asset', 'liability', 'equity'])
    .eq('is_active', true)
    .order('code')
  if (ae) return NextResponse.json({ error: ae.message }, { status: 500 })

  const { data: balances, error: be } = await admin
    .from('account_opening_balances')
    .select('account_id, amount, source, as_of_date, note, updated_at')
  if (be) return NextResponse.json({ error: be.message }, { status: 500 })

  const map = new Map((balances ?? []).map(b => [b.account_id, b]))
  const rows = (accounts ?? []).map(a => {
    const b = map.get(a.id)
    return {
      ...a,
      amount: b?.amount ?? 0,
      source: b?.source ?? null,
      as_of_date: b?.as_of_date ?? null,
      note: b?.note ?? null,
      has_value: !!b,
    }
  })

  return NextResponse.json({ data: rows })
}

// PATCH /api/opening-balances  { account_id, amount, as_of_date?, note? }
// 수기 기초잔액 입력/수정. amount=0 이면 행 삭제.
export async function PATCH(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    account_id?: string
    amount?: number
    as_of_date?: string
    note?: string | null
  }
  if (!body.account_id) return NextResponse.json({ error: 'account_id가 필요합니다.' }, { status: 400 })
  const amount = Math.trunc(Number(body.amount ?? 0))
  if (!Number.isFinite(amount)) return NextResponse.json({ error: '금액이 올바르지 않습니다.' }, { status: 400 })

  if (amount === 0) {
    const { error } = await admin.from('account_opening_balances').delete().eq('account_id', body.account_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: true })
  }

  const row: Record<string, unknown> = { account_id: body.account_id, amount, source: 'manual' }
  if (body.as_of_date) row.as_of_date = body.as_of_date
  if (body.note !== undefined) row.note = body.note

  const { error } = await admin
    .from('account_opening_balances')
    .upsert(row, { onConflict: 'account_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
