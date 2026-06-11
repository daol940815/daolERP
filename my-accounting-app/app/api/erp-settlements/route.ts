import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// POST /api/erp-settlements — 정산 결제완료/미결제 처리
// body: { purchase_alias_id, settlement_month, action: 'pay'|'unpay',
//         paid_date?, paid_amount?, memo?, use_prepayment? }
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({}))

  const { purchase_alias_id, settlement_month, action } = body
  if (!purchase_alias_id || !settlement_month || !['pay', 'unpay'].includes(action)) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 })
  }

  const row = action === 'pay'
    ? {
        purchase_alias_id,
        settlement_month,
        status: 'paid',
        paid_date:   body.paid_date ?? new Date().toISOString().slice(0, 10),
        paid_amount: body.paid_amount != null ? Math.round(Number(body.paid_amount)) : null,
        memo:        body.memo ?? null,
      }
    : {
        purchase_alias_id,
        settlement_month,
        status: 'unpaid',
        paid_date: null,
        paid_amount: null,
        memo: body.memo ?? null,
      }

  const { data, error } = await admin
    .from('erp_purchase_settlements')
    .upsert(row, { onConflict: 'purchase_alias_id,settlement_month' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 결제 시 선입금에서 차감 옵션
  let warning: string | null = null
  if (action === 'pay' && body.use_prepayment && row.paid_amount) {
    const { data: entries } = await admin
      .from('erp_prepayments')
      .select('entry_type, amount')
      .eq('alias_id', purchase_alias_id)
    const balance = (entries ?? []).reduce(
      (s, e) => s + (e.entry_type === 'deposit' ? e.amount : -e.amount), 0)
    if (row.paid_amount > balance) {
      warning = `차감액(${row.paid_amount.toLocaleString()}원)이 선입금 잔액(${balance.toLocaleString()}원)을 초과합니다.`
    }
    const { error: pe } = await admin.from('erp_prepayments').insert({
      direction: 'purchase',
      alias_id: purchase_alias_id,
      entry_date: row.paid_date,
      entry_type: 'deduction',
      amount: row.paid_amount,
      settlement_id: data.id,
      memo: `${settlement_month} 정산 차감`,
    })
    if (pe) return NextResponse.json({ error: `선입금 차감 실패: ${pe.message}` }, { status: 500 })
  }

  // 미결제로 되돌릴 때 연결된 선입금 차감도 삭제
  if (action === 'unpay') {
    await admin.from('erp_prepayments').delete().eq('settlement_id', data.id)
  }

  return NextResponse.json({ data, warning })
}

// PATCH /api/erp-settlements — 품목 정산월 이월
// body: { item_ids: string[], settlement_month: 'YYYY-MM' }
export async function PATCH(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({}))

  const itemIds = body.item_ids as string[] | undefined
  const month   = body.settlement_month as string | undefined
  if (!Array.isArray(itemIds) || !itemIds.length || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'item_ids와 settlement_month(YYYY-MM)가 필요합니다.' }, { status: 400 })
  }

  const { error } = await admin
    .from('erp_order_items')
    .update({ settlement_month: month })
    .in('id', itemIds)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, moved: itemIds.length, settlement_month: month })
}
