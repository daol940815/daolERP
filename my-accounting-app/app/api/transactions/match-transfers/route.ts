import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { randomUUID } from 'crypto'

// POST /api/transactions/match-transfers
// 법인 내 타계좌 이체 거래 자동 쌍 매칭
//   - 출금(amount_out > 0, amount_in = 0) ↔ 입금(amount_in > 0, amount_out = 0)
//   - 동일 금액 + ±1일 + 다른 bank_account_id + 유일 매칭인 경우만 연결
// Body: { bank_account_id?: string }  — 지정 시 해당 계좌의 출금 기준으로 매칭
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({})) as { bank_account_id?: string }
  const bankAccountId = body.bank_account_id

  // 매칭되지 않은 출금 거래 (amount_out > 0, amount_in = 0)
  let outQuery = admin
    .from('transactions')
    .select('id, tx_date, amount_out, bank_account_id')
    .gt('amount_out', 0)
    .eq('amount_in', 0)
    .is('transfer_pair_id', null)
    .limit(3000)

  if (bankAccountId) outQuery = outQuery.eq('bank_account_id', bankAccountId)

  // 매칭되지 않은 입금 거래 (amount_in > 0, amount_out = 0)
  // 상대 계좌는 bankAccountId와 달라야 하므로 전체 계좌 대상으로 조회
  const inQuery = admin
    .from('transactions')
    .select('id, tx_date, amount_in, bank_account_id')
    .gt('amount_in', 0)
    .eq('amount_out', 0)
    .is('transfer_pair_id', null)
    .limit(3000)

  const [{ data: outgoing, error: outErr }, { data: incoming, error: inErr }] =
    await Promise.all([outQuery, inQuery])

  if (outErr || inErr) {
    return NextResponse.json({ error: (outErr ?? inErr)?.message }, { status: 500 })
  }

  if (!outgoing?.length || !incoming?.length) {
    return NextResponse.json({ matched: 0, total: outgoing?.length ?? 0 })
  }

  // 입금 거래를 금액 기준으로 인덱싱 — 빠른 후보 조회
  const byAmount = new Map<number, typeof incoming>()
  for (const tx of incoming) {
    const amt = tx.amount_in as number
    if (!byAmount.has(amt)) byAmount.set(amt, [])
    byAmount.get(amt)!.push(tx)
  }

  const pairs: Array<[string, string]> = []
  const usedIds = new Set<string>()

  for (const out of outgoing) {
    if (usedIds.has(out.id)) continue

    const amount   = out.amount_out as number
    const outDate  = new Date(out.tx_date as string).getTime()
    const candidates = (byAmount.get(amount) ?? []).filter(inTx => {
      if (usedIds.has(inTx.id))                              return false
      if (inTx.bank_account_id === out.bank_account_id)      return false
      const dayDiff = Math.abs(new Date(inTx.tx_date as string).getTime() - outDate) / 86_400_000
      return dayDiff <= 1
    })

    // 유일 매칭(ambiguous 제외)
    if (candidates.length === 1) {
      pairs.push([out.id, candidates[0].id])
      usedIds.add(out.id)
      usedIds.add(candidates[0].id)
    }
  }

  if (pairs.length === 0) {
    return NextResponse.json({ matched: 0, total: outgoing.length })
  }

  // 쌍마다 동일 UUID를 양쪽에 할당
  await Promise.all(
    pairs.flatMap(([outId, inId]) => {
      const pairId = randomUUID()
      return [
        admin.from('transactions').update({ transfer_pair_id: pairId }).eq('id', outId),
        admin.from('transactions').update({ transfer_pair_id: pairId }).eq('id', inId),
      ]
    }),
  )

  return NextResponse.json({ matched: pairs.length, total: outgoing.length })
}

// DELETE /api/transactions/match-transfers
// 이체 쌍 매칭 전체 초기화 (선택한 계좌 또는 전체)
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({})) as { bank_account_id?: string }

  let query = admin
    .from('transactions')
    .update({ transfer_pair_id: null })
    .not('transfer_pair_id', 'is', null)

  if (body.bank_account_id) {
    query = admin
      .from('transactions')
      .update({ transfer_pair_id: null })
      .eq('bank_account_id', body.bank_account_id)
      .not('transfer_pair_id', 'is', null)
  }

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
