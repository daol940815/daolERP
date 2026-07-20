import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { normalizeName } from '@/lib/name-similarity'
import { syncTransactionPaymentEntry } from '@/lib/vendor-ledger'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

  // 미태깅 거래가 6천 건이 넘어 PostgREST 기본 1000행 한도에 잘렸다 —
  // 페이지네이션으로 전체를 가져와야 뒤쪽 거래(예: 반환 입금)도 매칭된다.
  const txResult = await fetchAllRows<{ id: string; description: string | null; counterparty_name: string | null; amount_out: number | null; tx_date: string }>((from, to) =>
    admin
      .from('transactions')
      .select('id, description, counterparty_name, amount_out, tx_date')
      .is('vendor_id', null)
      .is('transfer_pair_id', null)
      .range(from, to),
  )
  if ('error' in txResult) return NextResponse.json({ error: txResult.error }, { status: 500 })
  const txs = txResult.data

  // 짧은 이름(정규화 3자 이하)은 다른 단어 속에 우연히 포함되기 쉽다
  // (예: '채움'이 '내일채움공제'에, '아이티'가 '한국아이티평가'에 걸림).
  // 앞뒤가 한글이 아닌 경계 위치에서 나타날 때만 인정한다 — '문대호(렌켄)'은 통과.
  const HANGUL = /[가-힣]/
  const boundaryMatch = (hayNoSpace: string, token: string): boolean => {
    let from = 0
    for (;;) {
      const idx = hayNoSpace.indexOf(token, from)
      if (idx < 0) return false
      const pre  = idx > 0 ? hayNoSpace[idx - 1] : ''
      const post = idx + token.length < hayNoSpace.length ? hayNoSpace[idx + token.length] : ''
      if (!HANGUL.test(pre) && !HANGUL.test(post)) return true
      from = idx + 1
    }
  }
  const nameMatches = (hayNorm: string, hayNoSpace: string, token: string): boolean => {
    if (token.length < 2 || !hayNorm.includes(token)) return false
    return token.length > 3 || boundaryMatch(hayNoSpace, token)
  }

  let matched = 0
  for (const tx of txs ?? []) {
    const desc          = (tx.description as string) ?? ''
    const counterparty  = (tx.counterparty_name as string | null) ?? ''
    const haystack       = `${desc} ${counterparty}`
    const haystackDigits = haystack.replace(/[^0-9]/g, '')
    const normHaystack   = normalizeName(haystack)
    const hayNoSpace     = haystack.replace(/\s/g, '')

    const hits = candidates.filter(v =>
      (v.bizDigits && haystackDigits.includes(v.bizDigits))
      || nameMatches(normHaystack, hayNoSpace, v.normName)
      || v.normAliases.some(alias => nameMatches(normHaystack, hayNoSpace, alias))
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
