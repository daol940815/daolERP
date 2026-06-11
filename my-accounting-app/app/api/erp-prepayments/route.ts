import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/erp-prepayments?direction=customer|purchase&aliasId=
// 원장 내역 + 별칭별 잔액 요약
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction = searchParams.get('direction')
  const aliasId   = searchParams.get('aliasId')

  let query = admin
    .from('erp_prepayments')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(3000)

  if (direction === 'customer' || direction === 'purchase') query = query.eq('direction', direction)
  if (aliasId) query = query.eq('alias_id', aliasId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 별칭별 잔액 (입금 합 − 차감 합)
  const balances = new Map<string, number>()
  for (const e of data ?? []) {
    const cur = balances.get(e.alias_id as string) ?? 0
    balances.set(e.alias_id as string, cur + (e.entry_type === 'deposit' ? e.amount : -e.amount))
  }

  return NextResponse.json({
    data: data ?? [],
    balances: Object.fromEntries(balances),
  })
}

// POST /api/erp-prepayments
// body: { direction, alias_id, entry_date, entry_type, amount, order_id?, settlement_id?, memo? }
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({}))

  const { direction, alias_id, entry_date, entry_type, amount } = body
  if (!direction || !alias_id || !entry_date || !entry_type || !amount) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 })
  }
  if (!['deposit', 'deduction'].includes(entry_type)) {
    return NextResponse.json({ error: 'entry_type이 올바르지 않습니다.' }, { status: 400 })
  }
  const amt = Math.round(Number(amount))
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: '금액은 0보다 커야 합니다.' }, { status: 400 })
  }

  // 차감 시 잔액 확인 (초과해도 경고만 — 강제 차단하지 않음)
  let warning: string | null = null
  if (entry_type === 'deduction') {
    const { data: entries } = await admin
      .from('erp_prepayments')
      .select('entry_type, amount')
      .eq('alias_id', alias_id)
    const balance = (entries ?? []).reduce(
      (s, e) => s + (e.entry_type === 'deposit' ? e.amount : -e.amount), 0)
    if (amt > balance) {
      warning = `차감액(${amt.toLocaleString()}원)이 잔액(${balance.toLocaleString()}원)을 초과합니다.`
    }
  }

  const { data, error } = await admin
    .from('erp_prepayments')
    .insert({
      direction,
      alias_id,
      entry_date,
      entry_type,
      amount: amt,
      order_id:      body.order_id ?? null,
      settlement_id: body.settlement_id ?? null,
      memo:          body.memo ?? null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data, warning })
}

// DELETE /api/erp-prepayments — body: { id } (차감 취소/입금 삭제 → 잔액 자동 복구)
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const { id } = await req.json().catch(() => ({ id: null })) as { id: string | null }
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const { error } = await admin.from('erp_prepayments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
