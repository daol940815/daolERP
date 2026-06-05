import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/transactions/matched-pairs
// DB에 저장된 이체쌍 전체 조회 (transfer_pair_id 기준으로 그룹)
export async function GET() {
  const admin = createAdminClient()

  const LIMIT = 5000
  const { data, error } = await admin
    .from('transactions')
    .select('id, tx_date, amount_in, amount_out, description, account_alias, bank_account_id, transfer_pair_id')
    .not('transfer_pair_id', 'is', null)
    .order('tx_date', { ascending: false })
    .limit(LIMIT + 1)  // 1개 초과 조회로 절단 여부 판별

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const truncated = (data?.length ?? 0) > LIMIT
  const rows = truncated ? data!.slice(0, LIMIT) : (data ?? [])

  // transfer_pair_id 기준으로 그룹핑
  const grouped = new Map<string, typeof rows>()
  for (const tx of rows) {
    const pid = tx.transfer_pair_id as string
    if (!grouped.has(pid)) grouped.set(pid, [])
    grouped.get(pid)!.push(tx)
  }

  const pairs = Array.from(grouped.entries()).map(([pair_id, txs]) => {
    // 일반 이체: amount_out > 0 인 쪽이 출금, amount_in > 0 인 다른 쪽이 입금
    // 마이너스 통장: 양쪽 모두 amount_out = 0 → 배열 순서로 구분
    const outTx = txs.find(t => (t.amount_out as number) > 0)
    const inTx  = txs.find(t => (t.amount_in  as number) > 0 && t.id !== outTx?.id)

    const out = outTx ?? txs[0]
    const inp = inTx  ?? txs.find(t => t.id !== out.id) ?? txs[1]
    return { pair_id, out, in: inp }
  })

  pairs.sort((a, b) =>
    new Date(b.out?.tx_date as string).getTime() - new Date(a.out?.tx_date as string).getTime()
  )

  return NextResponse.json({ pairs, total: pairs.length, truncated })
}
