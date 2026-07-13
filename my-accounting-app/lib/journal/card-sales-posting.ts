import type { SupabaseClient } from '@supabase/supabase-js'
import { type JournalDraft, type JournalLineDraft } from './types'
import { postJournal, unpostJournal } from './posting'

// 카드매출 자동분개 (업무 규칙). 저장은 post_journal(RPC)이 담당.
//
// 규칙(설계 합의):
//   승인: (차) 매출채권(1101) [거래처=카드사] 총액
//         (대) 상품매출(4001) 공급가 + 부가세예수금(2003) 세액
//   취소: 위 역분개 (음수 세금계산서와 동일한 부호 반전 방식)
//   * 카드 승인은 분류 판단이 없는 사실 데이터 → 자동 전기 (통장=추천→확정과 구분)
//   * 매출 인식일 = 승인일(tx_date). 정산 입금은 통장 분류로 매출채권을 상계.
//   * 미수금 원장 축 = 매입사(카드사). acquirer 표기를 표준 카드사명으로 정규화해
//     is_card_company 거래처에 태깅 → 카드사별 미수 잔액이 거래처 원장에서 보인다.
//   * 공급가/세액이 없거나(수기 PG 일부) 합계가 안 맞으면 전기하지 않고 검토 대상으로 남긴다.

// 매입사 표기 → 표준 카드사명 ('외환'=하나카드 전신, '하나SK카드' 등 흡수)
export function canonicalAcquirer(acquirer: string | null): string | null {
  if (!acquirer) return null
  const s = acquirer.toLowerCase()
  if (s.includes('하나') || s.includes('외환')) return '하나카드'
  if (s.includes('비씨') || s.includes('bc'))   return 'BC카드'
  if (s.includes('국민') || s.includes('kb'))   return 'KB국민카드'
  if (s.includes('신한')) return '신한카드'
  if (s.includes('삼성')) return '삼성카드'
  if (s.includes('현대')) return '현대카드'
  if (s.includes('농협') || s.includes('nh'))   return 'NH농협카드'
  if (s.includes('롯데')) return '롯데카드'
  return null
}

export interface CardSaleForPosting {
  id: string
  tx_date: string
  transaction_type: 'approval' | 'cancel'
  approval_number: string | null
  acquirer: string | null
  amount: number | null
  supply_amount: number | null
  tax_amount: number | null
}

// 계정/카드사 거래처 사전 조회 컨텍스트 — 대량 전기 시 행마다 재조회하지 않도록 공유
export interface CardSaleContext {
  receivableId: string          // 매출채권 1101
  salesId: string               // 상품매출 4001
  vatPayableId: string          // 부가세예수금 2003
  cardVendorByName: Map<string, string>   // 표준 카드사명 → vendor id (is_card_company)
}

export async function loadCardSaleContext(
  admin: SupabaseClient,
): Promise<CardSaleContext | { error: string }> {
  const { data: accounts, error: aErr } = await admin
    .from('accounts').select('id, code').in('code', ['1101', '4001', '2003'])
  if (aErr) return { error: aErr.message }
  const byCode = new Map((accounts ?? []).map(a => [a.code as string, a.id as string]))
  const receivableId = byCode.get('1101'); const salesId = byCode.get('4001'); const vatPayableId = byCode.get('2003')
  if (!receivableId || !salesId || !vatPayableId) {
    return { error: '필수 계정(매출채권1101·매출4001·부가세예수금2003)을 찾을 수 없습니다.' }
  }
  const { data: vendors, error: vErr } = await admin
    .from('vendors').select('id, name').eq('is_card_company', true)
  if (vErr) return { error: vErr.message }
  return {
    receivableId, salesId, vatPayableId,
    cardVendorByName: new Map((vendors ?? []).map(v => [v.name as string, v.id as string])),
  }
}

export function buildCardSalePosting(
  sale: CardSaleForPosting,
  ctx: CardSaleContext,
): JournalDraft | { error: string } {
  const amount = sale.amount ?? 0
  if (amount === 0) return { error: '전기할 금액이 없습니다.' }

  const canonical = canonicalAcquirer(sale.acquirer)
  if (!canonical) return { error: `매입사 인식 불가: "${sale.acquirer ?? ''}" — 검토 필요` }
  const vendorId = ctx.cardVendorByName.get(canonical)
  if (!vendorId) return { error: `카드사 거래처 없음: ${canonical} (마이그레이션 054 필요)` }

  // 부호: 취소(또는 음수 금액)는 역분개. 금액은 절대값으로 통일.
  const isReversal = sale.transaction_type === 'cancel' || amount < 0
  const absAmount = Math.abs(amount)
  const supply = Math.abs(sale.supply_amount ?? 0)
  const vat = Math.abs(sale.tax_amount ?? 0)

  // 공급가/세액 검증 — 없거나 합계 불일치면 전기하지 않음 (과세/면세를 단정하지 않는다)
  if (supply <= 0) return { error: '공급가액 미보유 — 검토 필요(수기결제 등)' }
  if (supply + vat !== absAmount) {
    return { error: `공급가+세액(${(supply + vat).toLocaleString()}) ≠ 금액(${absAmount.toLocaleString()}) — 검토 필요` }
  }

  const S = (normal: 'debit' | 'credit'): 'debit' | 'credit' =>
    isReversal ? (normal === 'debit' ? 'credit' : 'debit') : normal

  const lines: JournalLineDraft[] = [
    { account_id: ctx.receivableId, side: S('debit'),  amount: absAmount, vendor_id: vendorId },
    { account_id: ctx.salesId,      side: S('credit'), amount: supply,    vendor_id: null },
  ]
  if (vat > 0) lines.push({ account_id: ctx.vatPayableId, side: S('credit'), amount: vat, vendor_id: null })

  return {
    source_type: 'card_sale',
    source_id: sale.id,
    entry_date: sale.tx_date.slice(0, 10),
    description: `카드매출 ${canonical}${sale.transaction_type === 'cancel' ? ' 취소' : ''} (승인 ${sale.approval_number ?? '-'})`,
    entry_type: 'normal',
    lines,
  }
}

// 카드매출 1건의 분개를 현재 상태에 맞춰 동기화한다(멱등).
//  - 금액·공급가 정합 & 매입사 인식 → 전기 / 그 외 → 전기 취소(검토 대상)
export async function syncCardSaleJournal(
  admin: SupabaseClient,
  saleId: string,
  sharedCtx?: CardSaleContext,
): Promise<{ ok: true } | { error: string }> {
  const { data: sale, error } = await admin
    .from('card_sales')
    .select('id, tx_date, transaction_type, approval_number, acquirer, amount, supply_amount, tax_amount')
    .eq('id', saleId)
    .single()
  if (error) return { error: error.message }

  const ctx = sharedCtx ?? await loadCardSaleContext(admin)
  if ('error' in ctx) return ctx

  const draft = buildCardSalePosting(sale as CardSaleForPosting, ctx)
  if ('error' in draft) {
    // 전기 불가(검토 대상)면 기존 분개는 제거해 정합성 유지
    await unpostJournal(admin, 'card_sale', saleId)
    return { error: draft.error }
  }
  const res = await postJournal(admin, draft)
  return 'error' in res ? res : { ok: true }
}
