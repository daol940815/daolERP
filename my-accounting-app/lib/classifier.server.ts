import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ── 카드정산 입금 추천 ────────────────────────────────────────
// 카드사 정산 입금은 "카드사명+계좌/승인 코드 숫자" 형식의 전용 패턴으로만 판정한다.
// ("하나카드 경영지원팀" 같은 일반 매출처 적요는 여기 걸리지 않음 — 거래처 매칭으로 흘러감)
// 판정 = ① 정산 전용 패턴 + ② is_card_company 거래처 존재.
// 미수잔액(매출채권-카드사)은 차단 조건이 아니라 신뢰도 신호: 있으면 High(0.9), 없으면 Medium(0.7).
const SETTLEMENT_PATTERNS: { canonical: string; re: RegExp }[] = [
  { canonical: '하나카드',    re: /^하나\d/ },
  { canonical: 'BC카드',      re: /^BC[-]?\d/i },
  { canonical: 'KB국민카드',  re: /^KB\d/i },
  { canonical: '신한카드',    re: /^신한\d/ },
  { canonical: '현대카드',    re: /^현대\d/ },
  { canonical: '삼성카드',    re: /^삼성\d/ },
  { canonical: 'NH농협카드',  re: /^NH\d/i },
  { canonical: '롯데카드',    re: /^롯데\d/ },
]

export async function suggestCardSettlements(
  admin: SupabaseClient,
  uploadLogId?: string,
  bankAccountId?: string,
): Promise<{ suggested: number; high: number; medium: number }> {
  // 매출채권(1101) + 카드사 거래처
  const { data: recv } = await admin
    .from('accounts').select('id, side_on_in').eq('code', '1101').maybeSingle()
  if (!recv) return { suggested: 0, high: 0, medium: 0 }

  const { data: cardVendors } = await admin
    .from('vendors').select('id, name').eq('is_card_company', true)
  if (!cardVendors?.length) return { suggested: 0, high: 0, medium: 0 }
  const vendorByName = new Map(cardVendors.map(v => [v.name as string, v.id as string]))
  const cardVendorIds = cardVendors.map(v => v.id as string)

  // 카드사별 매출채권 잔액 (전기된 분개 기준) — 신뢰도 신호
  const linesResult = await fetchAllRows<{ vendor_id: string; side: string; amount: number }>((f, t) =>
    admin
      .from('journal_lines')
      .select('vendor_id, side, amount')
      .eq('account_id', recv.id)
      .in('vendor_id', cardVendorIds)
      .range(f, t),
  )
  const arBalance = new Map<string, number>()
  if (!('error' in linesResult)) {
    for (const l of linesResult.data) {
      const cur = arBalance.get(l.vendor_id) ?? 0
      arBalance.set(l.vendor_id, cur + (l.side === 'debit' ? l.amount : -l.amount))
    }
  }

  // 미추천 pending 입금 거래
  const txResult = await fetchAllRows<{ id: string; description: string | null; vendor_id: string | null }>((f, t) => {
    let q = admin
      .from('transactions')
      .select('id, description, vendor_id')
      .is('suggested_account_id', null)
      .eq('status', 'pending')
      .is('transfer_pair_id', null)
      .gt('amount_in', 0)
    if (uploadLogId)   q = q.eq('upload_log_id', uploadLogId)
    if (bankAccountId) q = q.eq('bank_account_id', bankAccountId)
    return q.range(f, t)
  })
  if ('error' in txResult) return { suggested: 0, high: 0, medium: 0 }

  let suggested = 0, high = 0, medium = 0
  const side = (recv.side_on_in as 'debit' | 'credit' | null) ?? 'credit'   // 입금 → 매출채권 감소(대변)

  for (const tx of txResult.data) {
    const desc = (tx.description ?? '').trim()
    const hit = SETTLEMENT_PATTERNS.find(p => p.re.test(desc))
    if (!hit) continue
    const vendorId = vendorByName.get(hit.canonical)
    if (!vendorId) continue

    const balance = arBalance.get(vendorId) ?? 0
    const isHigh = balance > 0
    await admin
      .from('transactions')
      .update({
        suggested_account_id: recv.id,
        suggested_side:       side,
        ai_confidence:        isHigh ? 0.9 : 0.7,
        ai_reason:            `카드정산 패턴: ${hit.canonical}${isHigh ? ' · 미수잔액 확인' : ' · 미수잔액 없음(검토)'}`,
        ...(tx.vendor_id ? {} : { vendor_id: vendorId }),
      })
      .eq('id', tx.id)
    suggested++
    if (isHigh) high++
    else medium++
  }

  return { suggested, high, medium }
}

// 은행 이체 거래 패턴 — 키워드 분류 대상에서 제외
// 이체는 비용/수익이 아닌 계좌 간 자산 이동이므로 키워드 매칭을 건너뜀
// 주의: '자동이체'는 포함하지 않음 — 공과금·보험료 자동납부는 비용으로 분류 필요
const TRANSFER_PATTERNS = [
  '출금이체', '입금이체',
  '타행이체', '자행이체',
  '인터넷이체',
  '계좌이체', '온라인이체',
  '폰뱅킹이체', '텔레뱅킹이체',
  '대체입금', '대체출금',   // KB 형식
  'otp이체',
]

function isTransfer(description: string): boolean {
  const d = description.toLowerCase()
  return TRANSFER_PATTERNS.some(p => d.includes(p))
}

// 업로드된 거래에 계정과목 keywords 기반 자동 분류 + 차변/대변 결정 (2단계)
// Step 1: 키워드 매칭 → suggested_account_id
// Step 2: 계정별 방향 규칙(side_on_in / side_on_out) → suggested_side
export async function classifyByKeywords(
  admin: SupabaseClient,
  uploadLogId?: string,
  bankAccountId?: string,
): Promise<{ classified: number; total: number }> {
  // 활성 계정과목 + keywords + 방향 규칙 조회
  const { data: accounts } = await admin
    .from('accounts')
    .select('id, type, keywords, side_on_in, side_on_out')
    .eq('is_active', true)

  if (!accounts?.length) return { classified: 0, total: 0 }

  // keywords가 있는 계정만 필터
  const accountsWithKw = accounts.filter(
    (a) => Array.isArray(a.keywords) && a.keywords.length > 0,
  )
  if (!accountsWithKw.length) return { classified: 0, total: 0 }

  // suggested_account_id가 없는 pending 거래 조회
  const result = await fetchAllRows<{
    id: string
    description: string
    amount_in: number | null
    amount_out: number | null
  }>((from, to) => {
    let query = admin
      .from('transactions')
      .select('id, description, amount_in, amount_out')
      .is('suggested_account_id', null)
      .eq('status', 'pending')
    if (uploadLogId)   query = query.eq('upload_log_id', uploadLogId)
    if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
    return query.range(from, to)
  })
  if ('error' in result) return { classified: 0, total: 0 }
  const transactions = result.data
  if (!transactions.length) return { classified: 0, total: 0 }

  let classified = 0

  for (const tx of transactions) {
    // 이체 거래는 키워드 분류 제외 — 미분류 상태로 유지해 수동 처리
    if (isTransfer(tx.description as string)) continue

    const descLower = (tx.description as string).toLowerCase()

    // 거래 방향 — 방향 가드에 사용
    const isInflow  = (tx.amount_in  ?? 0) > 0   // 입금
    const isOutflow = (tx.amount_out ?? 0) > 0   // 출금

    // 계정 등록 순서가 아니라, 매칭되는 키워드 중 가장 긴(구체적인) 것을 우선 채택
    // — 짧은 범용 키워드가 더 구체적인 키워드보다 먼저 등록돼 있어도 오분류되지 않도록 함
    let best: { account: typeof accountsWithKw[number]; keyword: string } | null = null
    for (const account of accountsWithKw) {
      // 방향 가드: 거래처명에 우연히 비용/수익 키워드가 섞여도 방향이 어긋나면 제안하지 않는다.
      //  - 입금(수입)인데 비용계정(expense) 제안 금지  (예: '법무법인신원' 입금 → 지급수수료 ✗)
      //  - 출금(지출)인데 수익계정(income) 제안 금지
      if (isInflow  && account.type === 'expense') continue
      if (isOutflow && account.type === 'income')  continue
      for (const kw of account.keywords as string[]) {
        if (descLower.includes(kw.toLowerCase()) && (!best || kw.length > best.keyword.length)) {
          best = { account, keyword: kw }
        }
      }
    }

    if (best) {
      // Step 2: 계정별 방향 규칙으로 차변/대변 결정
      const side = isInflow
        ? (best.account.side_on_in  ?? 'credit')   // 입금 시 방향 (기본: 대변)
        : (best.account.side_on_out ?? 'debit')     // 출금 시 방향 (기본: 차변)

      await admin
        .from('transactions')
        .update({
          suggested_account_id: best.account.id,
          suggested_side:       side,
          ai_confidence:        0.8,
          ai_reason:            `키워드 매칭: "${best.keyword}"`,
        })
        .eq('id', tx.id)
      classified++
    }
  }

  return { classified, total: transactions.length }
}
