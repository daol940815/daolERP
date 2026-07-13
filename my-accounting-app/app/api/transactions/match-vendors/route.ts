import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { normalizeName } from '@/lib/name-similarity'
import { syncTransactionPaymentEntry } from '@/lib/vendor-ledger'

export const dynamic = 'force-dynamic'

// POST /api/transactions/match-vendors
// 거래처가 지정되지 않은 입출금 내역 중, 적요·입금자명에 거래처의 사업자번호·상호명·
// 학습된 별칭(match_aliases)이 단 하나의 거래처로만 일치하는 건을 자동으로 연결한다.
// 상호명·별칭 비교는 법인 표기("주식회사"/"(주)")·공백·특수문자 차이를 무시하도록
// normalizeName으로 정규화한 뒤 포함관계로 판단한다(편집거리 기반 유사매칭은 오매칭
// 위험이 있어 적용하지 않음).
export async function POST() {
  const admin = createAdminClient()

  const { data: vendors, error: vErr } = await admin
    .from('vendors')
    .select('id, name, biz_number, match_aliases')
    .eq('is_active', true)
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })

  const candidates = (vendors ?? []).map(v => ({
    id:          v.id as string,
    bizDigits:   (v.biz_number as string | null)?.replace(/[^0-9]/g, '') ?? '',
    normName:    normalizeName((v.name as string).trim()),
    normAliases: ((v.match_aliases as string[] | null) ?? [])
      .filter(Boolean)
      .map(normalizeName)
      .filter(Boolean),
  }))

  const { data: txs, error: tErr } = await admin
    .from('transactions')
    .select('id, description, counterparty_name, amount_out, tx_date')
    .is('vendor_id', null)
    .is('transfer_pair_id', null)
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  let matched = 0
  for (const tx of txs ?? []) {
    const desc          = (tx.description as string) ?? ''
    const counterparty  = (tx.counterparty_name as string | null) ?? ''
    const haystack       = `${desc} ${counterparty}`
    const haystackDigits = haystack.replace(/[^0-9]/g, '')
    const normHaystack   = normalizeName(haystack)

    const hits = candidates.filter(v =>
      (v.bizDigits && haystackDigits.includes(v.bizDigits))
      || (v.normName.length >= 2 && normHaystack.includes(v.normName))
      || v.normAliases.some(alias => alias.length >= 2 && normHaystack.includes(alias))
    )

    if (hits.length === 1) {
      await admin.from('transactions')
        .update({ vendor_id: hits[0].id })
        .eq('id', tx.id)
      await syncTransactionPaymentEntry(admin, {
        transactionId: tx.id as string,
        prevVendorId:  null,
        newVendorId:   hits[0].id,
        amountOut:     (tx.amount_out as number | null) ?? 0,
        txDate:        tx.tx_date as string,
        description:   desc || null,
      })
      matched++
    }
  }

  return NextResponse.json({ matched, checked: txs?.length ?? 0 })
}
