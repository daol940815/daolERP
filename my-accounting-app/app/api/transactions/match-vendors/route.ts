import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// POST /api/transactions/match-vendors
// 거래처가 지정되지 않은 입출금 내역 중, 적요·입금자명에 거래처의 사업자번호·상호명·
// 학습된 별칭(match_aliases)이 단 하나의 거래처로만 일치하는 건을 자동으로 연결한다.
export async function POST() {
  const admin = createAdminClient()

  const { data: vendors, error: vErr } = await admin
    .from('vendors')
    .select('id, name, biz_number, match_aliases')
    .eq('is_active', true)
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })

  const candidates = (vendors ?? []).map(v => ({
    id:        v.id as string,
    bizDigits: (v.biz_number as string | null)?.replace(/[^0-9]/g, '') ?? '',
    name:      (v.name as string).trim(),
    aliases:   ((v.match_aliases as string[] | null) ?? []).filter(Boolean),
  }))

  const { data: txs, error: tErr } = await admin
    .from('transactions')
    .select('id, description, counterparty_name')
    .is('vendor_id', null)
    .is('transfer_pair_id', null)
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  let matched = 0
  for (const tx of txs ?? []) {
    const desc           = (tx.description as string) ?? ''
    const counterparty   = (tx.counterparty_name as string | null) ?? ''
    const haystack       = `${desc} ${counterparty}`
    const haystackDigits = haystack.replace(/[^0-9]/g, '')

    const hits = candidates.filter(v =>
      (v.bizDigits && haystackDigits.includes(v.bizDigits))
      || (v.name && haystack.includes(v.name))
      || v.aliases.some(alias => haystack.includes(alias))
    )

    if (hits.length === 1) {
      await admin.from('transactions')
        .update({ vendor_id: hits[0].id })
        .eq('id', tx.id)
      matched++
    }
  }

  return NextResponse.json({ matched, checked: txs?.length ?? 0 })
}
