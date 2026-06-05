import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/transactions/matched-pairs
// DB에 저장된 이체쌍 전체 조회 (transfer_pair_id 기준으로 그룹)
export async function GET() {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('transactions')
    .select('id, tx_date, amount_in, amount_out, description, account_alias, bank_account_id, transfer_pair_id')
    .not('transfer_pair_id', 'is', null)
    .order('tx_date', { ascending: false })
    .limit(5000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // transfer_pair_id 기준으로 그룹핑
  const grouped = new Map<string, typeof data>()
  for (const tx of data ?? []) {
    const pid = tx.transfer_pair_id as string
    if (!grouped.has(pid)) grouped.set(pid, [])
    grouped.get(pid)!.push(tx)
  }

  const pairs = Array.from(grouped.entries()).map(([pair_id, txs]) => {
    const out = txs.find(t => (t.amount_out as number) > 0) ?? txs[0]
    const inp = txs.find(t => (t.amount_in  as number) > 0) ?? txs[1]
    return { pair_id, out, in: inp }
  })

  // 출금 날짜 기준 최신순
  pairs.sort((a, b) =>
    new Date(b.out?.tx_date as string).getTime() - new Date(a.out?.tx_date as string).getTime()
  )

  return NextResponse.json({ pairs, total: pairs.length })
}
