import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { normalizeName } from '@/lib/name-similarity'
import { syncTransactionPaymentEntry } from '@/lib/vendor-ledger'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { bankKeywordsColumnExists, bankKeywordsOf } from '@/lib/vendor-keywords.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/transactions/match-vendors
// 거래처가 지정되지 않은 입출금 내역 중, 적요·입금자명에 거래처의 사업자번호·상호명·
// 학습된 별칭(match_aliases)이 단 하나의 거래처로만 일치하는 건을 자동으로 연결한다.
// 상호명·별칭 비교는 법인 표기("주식회사"/"(주)")·공백·특수문자 차이를 무시하도록
// normalizeName으로 정규화한 뒤 포함관계로 판단한다(편집거리 기반 유사매칭은 오매칭
// 위험이 있어 적용하지 않음).
// 연결 후보 계산 (저장 없음) — 미리보기(GET)와 실행(POST)이 같은 결과를 쓴다 (2026-11-16 통장 내역 버튼 정리)
interface VendorMatch {
  tx: { id: string; description: string | null; counterparty_name: string | null; amount_in: number | null; amount_out: number | null; tx_date: string; account_alias: string | null }
  vendor: { id: string; name: string }
  reason: '사업자번호' | '상호' | '통장 키워드'
}
async function computeVendorMatches(admin: ReturnType<typeof createAdminClient>): Promise<{ error: string } | { matches: VendorMatch[]; checked: number }> {

  // 전량 페이지 조회 — 단일 조회는 1000행에서 잘려 뒤쪽 거래처가 후보에서 빠진다 (2026-10-22)
  // 423: 통장 매칭은 통장 키워드(bank_keywords)만 본다 — 계산서 키워드(match_aliases)는 계산서 매칭 전용.
  // 컬럼이 없으면(423 미실행) 옛 방식대로 match_aliases.
  const hasBank = await bankKeywordsColumnExists(admin)
  const vendorsResult = await fetchAllRows<{ id: string; name: string; biz_number: string | null; match_aliases: string[] | null; bank_keywords?: string[] | null }>((f, t) =>
    admin.from('vendors').select((hasBank ? 'id, name, biz_number, match_aliases, bank_keywords' : 'id, name, biz_number, match_aliases') as string)
      .eq('is_active', true).eq('status', 'active').range(f, t) as unknown as PromiseLike<{ data: { id: string; name: string; biz_number: string | null; match_aliases: string[] | null; bank_keywords?: string[] | null }[] | null; error: { message: string } | null }>)
  if ('error' in vendorsResult) return { error: vendorsResult.error }
  const vendors = vendorsResult.data

  const candidates = (vendors ?? []).map(v => ({
    id:          v.id as string,
    name:        v.name as string,
    bizDigits:   (v.biz_number as string | null)?.replace(/[^0-9]/g, '') ?? '',
    normName:    normalizeName((v.name as string).trim()),
    normAliases: bankKeywordsOf(v, hasBank)
      .map(normalizeName)
      .filter(Boolean),
  }))

  // 미태깅 거래가 6천 건이 넘어 PostgREST 기본 1000행 한도에 잘렸다 —
  // 페이지네이션으로 전체를 가져와야 뒤쪽 거래(예: 반환 입금)도 매칭된다.
  const txResult = await fetchAllRows<{ id: string; description: string | null; counterparty_name: string | null; amount_in: number | null; amount_out: number | null; tx_date: string; account_alias: string | null }>((from, to) =>
    admin
      .from('transactions')
      .select('id, description, counterparty_name, amount_in, amount_out, tx_date, account_alias')
      .is('vendor_id', null)
      .is('transfer_pair_id', null)
      .range(from, to),
  )
  if ('error' in txResult) return { error: txResult.error }
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

  const matches: VendorMatch[] = []
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
    if (hits.length !== 1) continue
    const v = hits[0]
    const reason: VendorMatch['reason'] = v.bizDigits && haystackDigits.includes(v.bizDigits) ? '사업자번호'
      : nameMatches(normHaystack, hayNoSpace, v.normName) ? '상호' : '통장 키워드'
    matches.push({ tx, vendor: { id: v.id, name: v.name }, reason })
  }
  return { matches, checked: txs?.length ?? 0 }
}

// GET /api/transactions/match-vendors — 미리보기: 연결될 거래 · 거래처 · 근거 (저장 없음)
export async function GET() {
  const r = await computeVendorMatches(createAdminClient())
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ checked: r.checked, total: r.matches.length, matches: r.matches.slice(0, 2000) })
}

// POST /api/transactions/match-vendors  body: { ids?: string[] }
// ids가 오면 그 거래만 연결한다(미리보기에서 체크한 것). 없으면 후보 전부(옛 동작).
// 후보는 실행 시점에 다시 계산한다 — 미리보기 뒤에 바뀐 거래는 자동으로 빠진다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { ids?: string[] }
  const only = Array.isArray(body.ids) ? new Set(body.ids) : null
  const r = await computeVendorMatches(admin)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  let matched = 0
  for (const m of r.matches) {
    if (only && !only.has(m.tx.id)) continue
    await admin.from('transactions').update({ vendor_id: m.vendor.id }).eq('id', m.tx.id).is('vendor_id', null)
    await syncTransactionPaymentEntry(admin, {
      transactionId: m.tx.id,
      prevVendorId:  null,
      newVendorId:   m.vendor.id,
      amountOut:     m.tx.amount_out ?? 0,
      txDate:        m.tx.tx_date,
      description:   m.tx.description || null,
    })
    matched++
  }
  return NextResponse.json({ matched, checked: r.checked })
}
