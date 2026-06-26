import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { syncTransactionJournal } from '@/lib/journal/bank-posting'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/journal/backfill
// 이미 확정(confirmed)된 은행거래를 일괄 전기한다(멱등 — 여러 번 실행해도 안전).
export async function POST() {
  const admin = createAdminClient()

  const result = await fetchAllRows<{ id: string }>((f, t) =>
    admin
      .from('transactions')
      .select('id')
      .eq('status', 'confirmed')
      .not('confirmed_account_id', 'is', null)
      .is('transfer_pair_id', null)
      .range(f, t),
  )
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  let posted = 0
  const errors: { id: string; error: string }[] = []
  for (const tx of result.data) {
    const jr = await syncTransactionJournal(admin, tx.id)
    if ('error' in jr) errors.push({ id: tx.id, error: jr.error })
    else posted++
  }

  return NextResponse.json({ candidates: result.data.length, posted, errors })
}
