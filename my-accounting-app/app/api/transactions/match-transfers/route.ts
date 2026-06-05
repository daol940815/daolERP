import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { randomUUID } from 'crypto'

// 매칭 조건:
//   1. description에 '다올' 포함 (ilike)
//   2. 동일 금액 + ±1일 + 다른 bank_account_id + 유일 매칭
//   Pass 1: amount_out > 0 ↔ amount_in > 0  (일반 이체)
//   Pass 2: amount_in > 0 ↔ amount_in > 0   (마이너스 통장 — 차입 출금이 amount_in으로 기록)

// GET /api/transactions/match-transfers?bank_account_id=...
// 드라이런: DB 저장 없이 매칭 가능 쌍 목록 반환
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const bankAccountId = new URL(req.url).searchParams.get('bank_account_id') ?? undefined

  const sel = 'id, tx_date, amount_in, amount_out, description, account_alias, bank_account_id'

  let outQuery = admin
    .from('transactions')
    .select(sel)
    .gt('amount_out', 0)
    .eq('amount_in', 0)
    .ilike('description', '%다올%')
    .is('transfer_pair_id', null)
    .limit(3000)

  if (bankAccountId) outQuery = outQuery.eq('bank_account_id', bankAccountId)

  const inQuery = admin
    .from('transactions')
    .select(sel)
    .gt('amount_in', 0)
    .eq('amount_out', 0)
    .ilike('description', '%다올%')
    .is('transfer_pair_id', null)
    .limit(3000)

  const [{ data: rawOut, error: outErr }, { data: rawIn, error: inErr }] =
    await Promise.all([outQuery, inQuery])

  if (outErr || inErr) {
    return NextResponse.json({ error: (outErr ?? inErr)?.message }, { status: 500 })
  }

  const outgoing = (rawOut ?? []) as Array<Record<string, unknown>>
  const incoming = (rawIn  ?? []) as Array<Record<string, unknown>>

  const pairs: Array<{ out: typeof outgoing[0]; in: typeof outgoing[0]; pairType: string }> = []
  const usedIds = new Set<string>()

  // Pass 1: amount_out → amount_in
  const byAmtIn = new Map<number, typeof incoming>()
  for (const tx of incoming) {
    const amt = tx.amount_in as number
    if (!byAmtIn.has(amt)) byAmtIn.set(amt, [])
    byAmtIn.get(amt)!.push(tx)
  }
  for (const out of outgoing) {
    if (usedIds.has(out.id as string)) continue
    const outDate   = new Date(out.tx_date as string).getTime()
    const candidates = (byAmtIn.get(out.amount_out as number) ?? []).filter(inTx => {
      if (usedIds.has(inTx.id as string)) return false
      if (inTx.bank_account_id === out.bank_account_id) return false
      return Math.abs(new Date(inTx.tx_date as string).getTime() - outDate) / 86_400_000 <= 1
    })
    if (candidates.length === 1) {
      pairs.push({ out, in: candidates[0], pairType: 'standard' })
      usedIds.add(out.id as string)
      usedIds.add(candidates[0].id as string)
    }
  }

  // Pass 2: amount_in ↔ amount_in (마이너스 통장)
  const remIn = incoming.filter(tx => !usedIds.has(tx.id as string))
  const byAmtIn2 = new Map<number, typeof remIn>()
  for (const tx of remIn) {
    const amt = tx.amount_in as number
    if (!byAmtIn2.has(amt)) byAmtIn2.set(amt, [])
    byAmtIn2.get(amt)!.push(tx)
  }
  for (const tx of remIn) {
    if (usedIds.has(tx.id as string)) continue
    const txDate = new Date(tx.tx_date as string).getTime()
    const candidates = (byAmtIn2.get(tx.amount_in as number) ?? []).filter(other => {
      if (other.id === tx.id) return false
      if (usedIds.has(other.id as string)) return false
      if (other.bank_account_id === tx.bank_account_id) return false
      return Math.abs(new Date(other.tx_date as string).getTime() - txDate) / 86_400_000 <= 1
    })
    if (candidates.length === 1) {
      pairs.push({ out: tx, in: candidates[0], pairType: 'minus-account' })
      usedIds.add(tx.id as string)
      usedIds.add(candidates[0].id as string)
    }
  }

  return NextResponse.json({ pairs, total: outgoing.length })
}

// POST /api/transactions/match-transfers
// Body: { bank_account_id?: string }
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({})) as { bank_account_id?: string }
  const bankAccountId = body.bank_account_id

  let outQuery = admin
    .from('transactions')
    .select('id, tx_date, amount_out, bank_account_id')
    .gt('amount_out', 0)
    .eq('amount_in', 0)
    .ilike('description', '%다올%')
    .is('transfer_pair_id', null)
    .limit(3000)

  if (bankAccountId) outQuery = outQuery.eq('bank_account_id', bankAccountId)

  const inQuery = admin
    .from('transactions')
    .select('id, tx_date, amount_in, bank_account_id')
    .gt('amount_in', 0)
    .eq('amount_out', 0)
    .ilike('description', '%다올%')
    .is('transfer_pair_id', null)
    .limit(3000)

  const [{ data: rawOut, error: outErr }, { data: rawIn, error: inErr }] =
    await Promise.all([outQuery, inQuery])

  if (outErr || inErr) {
    return NextResponse.json({ error: (outErr ?? inErr)?.message }, { status: 500 })
  }

  const outgoing = (rawOut ?? []) as Array<Record<string, unknown>>
  const incoming = (rawIn  ?? []) as Array<Record<string, unknown>>

  const pairs: Array<[string, string]> = []
  const usedIds = new Set<string>()

  // Pass 1: amount_out → amount_in
  const byAmtIn = new Map<number, typeof incoming>()
  for (const tx of incoming) {
    const amt = tx.amount_in as number
    if (!byAmtIn.has(amt)) byAmtIn.set(amt, [])
    byAmtIn.get(amt)!.push(tx)
  }
  for (const out of outgoing) {
    if (usedIds.has(out.id as string)) continue
    const outDate    = new Date(out.tx_date as string).getTime()
    const candidates = (byAmtIn.get(out.amount_out as number) ?? []).filter(inTx => {
      if (usedIds.has(inTx.id as string)) return false
      if (inTx.bank_account_id === out.bank_account_id) return false
      return Math.abs(new Date(inTx.tx_date as string).getTime() - outDate) / 86_400_000 <= 1
    })
    if (candidates.length === 1) {
      pairs.push([out.id as string, candidates[0].id as string])
      usedIds.add(out.id as string)
      usedIds.add(candidates[0].id as string)
    }
  }

  // Pass 2: amount_in ↔ amount_in (마이너스 통장)
  const remIn = incoming.filter(tx => !usedIds.has(tx.id as string))
  const byAmtIn2 = new Map<number, typeof remIn>()
  for (const tx of remIn) {
    const amt = tx.amount_in as number
    if (!byAmtIn2.has(amt)) byAmtIn2.set(amt, [])
    byAmtIn2.get(amt)!.push(tx)
  }
  for (const tx of remIn) {
    if (usedIds.has(tx.id as string)) continue
    const txDate     = new Date(tx.tx_date as string).getTime()
    const candidates = (byAmtIn2.get(tx.amount_in as number) ?? []).filter(other => {
      if (other.id === tx.id) return false
      if (usedIds.has(other.id as string)) return false
      if (other.bank_account_id === tx.bank_account_id) return false
      return Math.abs(new Date(other.tx_date as string).getTime() - txDate) / 86_400_000 <= 1
    })
    if (candidates.length === 1) {
      pairs.push([tx.id as string, candidates[0].id as string])
      usedIds.add(tx.id as string)
      usedIds.add(candidates[0].id as string)
    }
  }

  if (pairs.length === 0) {
    return NextResponse.json({ matched: 0, total: outgoing.length })
  }

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
// Body:
//   { pair_id: string }         — 특정 쌍만 해제
//   { bank_account_id: string } — 특정 계좌의 매칭 전체 해제
//   {}                          — 전체 매칭 초기화
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({})) as { bank_account_id?: string; pair_id?: string }

  const base = admin.from('transactions').update({ transfer_pair_id: null })

  const { error } = body.pair_id
    ? await base.eq('transfer_pair_id', body.pair_id)
    : body.bank_account_id
      ? await base.eq('bank_account_id', body.bank_account_id).not('transfer_pair_id', 'is', null)
      : await base.not('transfer_pair_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
