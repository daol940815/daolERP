import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { loadMatchingState, findAutoMatches } from '@/lib/erp-matching'

export const dynamic = 'force-dynamic'

// POST /api/erp-matching/run — 고신뢰 자동 매칭 실행
// body: { from?, to?, days? } — days: 입금일과 주문일 차이 허용 범위 (기본 7일)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { from?: string; to?: string; days?: number }

  const days = Math.min(Math.max(Number(body.days) || 7, 1), 120)
  const state = await loadMatchingState(admin, body.from ?? null, body.to ?? null)
  if ('error' in state) {
    return NextResponse.json(
      { error: state.missingTable
        ? '매칭 테이블이 없습니다. Supabase SQL Editor에서 마이그레이션 021_erp_payment_matches.sql을 실행해주세요.'
        : state.error },
      { status: state.missingTable ? 428 : 500 })
  }

  const pairs = findAutoMatches(state, days)
  if (!pairs.length) {
    return NextResponse.json({ matched: 0, amount: 0, pending: state.deposits.filter(d => d.remaining > 0).length })
  }

  const rows = pairs.map(p => ({
    order_id: p.order.id,
    source_type: 'bank',
    source_id: p.deposit.id,
    amount: p.deposit.remaining,
    paid_date: p.deposit.tx_date,
    matched_by: 'auto',
    memo: null,
  }))
  const { error } = await admin.from('erp_payment_matches').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    matched: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
    pending: state.deposits.filter(d => d.remaining > 0).length - rows.length,
  })
}
