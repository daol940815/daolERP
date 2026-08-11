import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const EDITABLE = [
  'title', 'bank_name', 'bank_account_id', 'original_amount', 'current_balance',
  'balance_date', 'interest_rate', 'rate_note', 'monthly_principal', 'monthly_interest',
  'payment_day', 'start_date', 'maturity_date', 'term_type', 'status', 'memo',
] as const

// PATCH /api/loans/[id] — 대출 정보 수정 (잔액·금리·만기·구분·상태 등)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: '요청 본문이 필요합니다.' }, { status: 400 })

  const row: Record<string, unknown> = {}
  for (const k of EDITABLE) if (k in body) row[k] = body[k] === '' ? null : body[k]
  if (!Object.keys(row).length) {
    return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 })
  }

  const { error } = await admin.from('loans').update(row).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
