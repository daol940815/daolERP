import type { SupabaseClient } from '@supabase/supabase-js'

// ── 매칭 공통 규칙 (docs/matching-rules.md 에 도구별 적용표) ─────────────────
//
// 업무 원칙 (다올커머스):
//   1. 매출은 계산서 발행 후 입금, 매입은 계산서 발행 후 지급이 원칙이다.
//      선지급/선입금(발행 전 거래)은 예외이며, 자동 연결하지 않고 사용자가 확인한다.
//   2. 다만 "선지급이 관행인 거래처"(고정지출 선납 후 계산서 수취)는 사용자의
//      확정 이력에서 자동 학습해, 수동 후보 화면에 한해 발행 전 거래도 동급으로 보여준다.
//   3. 금액 조건(정확 일치 · 잔여금액 검사)은 어떤 도구에서도 완화하지 않는다.

export const MATCH_RULES = {
  // 자동매칭(auto-match) — 실제 연결까지 수행하므로 가장 보수적
  AUTO_MARGIN_DAYS: 15,    // 후보 여럿일 때 최근접이 2등보다 이만큼 가까워야 유일 판정
  AUTO_MAX_LAG_DAYS: 35,   // 후보 여럿일 때 최근접이 발행 후 이 일수 이내여야 연결
  AUTO_PRE_GUARD_DAYS: 7,  // 발행 전 거래가 (최근접+이 값)보다 가까우면 애매 → 수동

  // 수동 후보 정렬(개별 매칭 · 합계 매칭) — C안
  MANUAL_PRE_GRACE_DAYS: 7,   // 발행 직전 이 일수 이내 후보는 발행 후와 동급 (월말 정산 관행)
  PREPAY_PRE_GRACE_DAYS: 31,  // 선지급 관행 거래처는 발행 전 한 달까지 동급
  SCORE_NEAR_BONUS_DAYS: 31,  // 발행일 ±이 일수 이내 후보에 신원 점수 +1 가점

  // 지급연결후보(매입 사이클 분할/합산) 탐색 창
  SPLIT_NEAR_WINDOW_DAYS: 30,  // 1차: 그 달 지급 우선
  SPLIT_MAX_WINDOW_DAYS: 120,  // 2차: 늦은 지급까지 확장

  // 선지급 관행 거래처 판정 (확정 이력 학습)
  PREPAY_MIN_COUNT: 2,   // 발행 전 지급으로 확정된 연결이 이 건수 이상이고
  PREPAY_MIN_RATIO: 0.5, // 전체 확정 중 비율이 이 값 이상이면 관행으로 본다
} as const

const DAY = 86_400_000

// 거래일 - 발행일 (일 단위, 음수 = 발행 전 거래)
export const lagDays = (txDate: string, issueDate: string) =>
  Math.round((new Date(txDate.slice(0, 10)).getTime() - new Date(issueDate.slice(0, 10)).getTime()) / DAY)

// ── 상대 판별 (4신호) ──────────────────────────────────────────
// 거래처 태깅 > 사업자번호 > 상호명 > 학습 별칭. 점수 0 = 무관한 거래.
export interface InvoiceIdentity {
  vendor_id: string | null
  counterparty_biz_number: string | null
  counterparty_name: string | null
}
export interface TxIdentity {
  description: string | null
  counterparty_name: string | null
  vendor_id: string | null
}

export function makeIdentityScorer(inv: InvoiceIdentity, aliases: string[]) {
  const bizDigits = inv.counterparty_biz_number?.replace(/[^0-9]/g, '') ?? ''
  const name      = inv.counterparty_name?.trim() ?? ''
  return (tx: TxIdentity): number => {
    const haystack       = `${tx.description ?? ''} ${tx.counterparty_name ?? ''}`
    const haystackDigits = haystack.replace(/[^0-9]/g, '')
    let score = 0
    if (inv.vendor_id && tx.vendor_id === inv.vendor_id)          score += 3
    if (bizDigits && haystackDigits.includes(bizDigits))          score += 2
    if (name && haystack.includes(name))                          score += 2
    if (aliases.some(alias => alias && haystack.includes(alias))) score += 2
    return score
  }
}

// ── 수동 후보 날짜 순위 (C안 + 선지급 관행 거래처) ─────────────
// 0 = 발행 후 또는 유예 내(동급) / 1 = 유예를 넘긴 발행 전 → 뒤로.
// 동순위 안에서는 발행일과의 절대거리 오름차순으로 정렬한다.
export function dateRank(lag: number, prepayVendor: boolean): 0 | 1 {
  const grace = prepayVendor ? MATCH_RULES.PREPAY_PRE_GRACE_DAYS : MATCH_RULES.MANUAL_PRE_GRACE_DAYS
  return lag >= -grace ? 0 : 1
}

// ── 선지급 관행 거래처 판정 ───────────────────────────────────
// 이 거래처 계산서의 확정 연결 이력에서 "발행 전 지급" 비율을 계산한다.
// 사용자가 선지급을 몇 번 확정하면 자동으로 관행으로 학습된다 (하드코딩 없음).
export async function isPrepayVendor(admin: SupabaseClient, vendorId: string | null): Promise<boolean> {
  if (!vendorId) return false
  const { data: invs } = await admin
    .from('tax_invoices')
    .select('id, issue_date')
    .eq('vendor_id', vendorId)
  if (!invs?.length) return false
  const issueById = new Map(invs.map(i => [i.id as string, i.issue_date as string]))

  let pre = 0, post = 0
  const ids = invs.map(i => i.id as string)
  for (let i = 0; i < ids.length; i += 100) {
    const { data: pays } = await admin
      .from('tax_invoice_payments')
      .select('tax_invoice_id, amount, transaction:transactions(tx_date)')
      .in('tax_invoice_id', ids.slice(i, i + 100))
    for (const p of pays ?? []) {
      if (((p.amount as number) ?? 0) <= 0) continue // 상계(음수) 연결은 제외
      const txDate = (p.transaction as { tx_date?: string } | null)?.tx_date
      const issue  = issueById.get(p.tax_invoice_id as string)
      if (!txDate || !issue) continue
      if (lagDays(txDate, issue) < 0) pre++
      else post++
    }
  }
  return pre >= MATCH_RULES.PREPAY_MIN_COUNT
    && pre / Math.max(1, pre + post) >= MATCH_RULES.PREPAY_MIN_RATIO
}
