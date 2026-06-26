import type { SupabaseClient } from '@supabase/supabase-js'
import { type JournalDraft } from './types'
import { postJournal, unpostJournal } from './posting'

// 법인카드 사용 자동분개 (업무 규칙). 저장은 post_journal(RPC)이 담당.
//
// 규칙(설계: docs/journal-design.md):
//   카드 사용: (차) 비용계정(confirmed) / (대) 미지급금(2001), 금액 = 승인금액
//   * 카드대금 결제(은행출금)는 별도로 미지급금 차변 처리 → 이중계상 방지(은행 분개에서 처리).
//   * 미지급금(2001)의 상대처(vendor)는 가맹점이 아니라 "카드사"다 — 카드사에 갚을 채무이므로,
//     card_accounts.vendor_id(카드사 거래처)를 미지급금 라인에 태깅한다(거래처별 원장 일관성).

export interface CardExpenseForPosting {
  id: string
  tx_date: string
  merchant_name: string | null
  approved_amount: number | null
  confirmed_account_id: string | null
  classify_status: string
}

export function buildCardPosting(
  exp: CardExpenseForPosting,
  payableAccountId: string,
  cardCompanyVendorId: string | null,
): JournalDraft | { error: string } {
  if (exp.classify_status !== 'confirmed' || !exp.confirmed_account_id) {
    return { error: '확정된 계정과목이 없습니다.' }
  }
  if (!payableAccountId) return { error: '미지급금(2001) 계정이 없습니다.' }
  const amount = exp.approved_amount ?? 0
  if (amount <= 0) return { error: '전기할 금액이 없습니다.' }

  return {
    source_type: 'card',
    source_id: exp.id,
    entry_date: exp.tx_date.slice(0, 10),
    description: exp.merchant_name,
    entry_type: 'normal',
    lines: [
      { account_id: exp.confirmed_account_id, side: 'debit',  amount, vendor_id: null },
      // 미지급금: 상대처 = 카드사
      { account_id: payableAccountId,         side: 'credit', amount, vendor_id: cardCompanyVendorId },
    ],
  }
}

// 카드 사용내역 1건의 분개를 현재 상태에 맞춰 동기화한다(멱등).
//  - classify_status='confirmed' & 계정 지정 & 금액>0 → 전기
//  - 그 외(미확정/계정해제)                              → 전기 취소
export async function syncCardExpenseJournal(
  admin: SupabaseClient,
  expenseId: string,
): Promise<{ ok: true } | { error: string }> {
  const { data: exp, error } = await admin
    .from('card_expenses')
    .select('id, tx_date, merchant_name, approved_amount, confirmed_account_id, classify_status, card_accounts(vendor_id)')
    .eq('id', expenseId)
    .single()
  if (error) return { error: error.message }

  // 미지급금 상대처 = 카드사 거래처 (card_accounts.vendor_id)
  const ca = (exp as { card_accounts?: { vendor_id: string | null } | { vendor_id: string | null }[] | null }).card_accounts
  const cardCompanyVendorId =
    (Array.isArray(ca) ? ca[0]?.vendor_id : ca?.vendor_id) ?? null

  const shouldPost =
    exp.classify_status === 'confirmed' &&
    !!exp.confirmed_account_id &&
    (exp.approved_amount ?? 0) > 0

  if (!shouldPost) {
    return unpostJournal(admin, 'card', expenseId).then(r => ('error' in r ? r : { ok: true as const }))
  }

  const { data: payable } = await admin.from('accounts').select('id').eq('code', '2001').single()
  const payableId = (payable?.id as string | undefined) ?? null
  if (!payableId) return { error: '미지급금(2001) 계정을 찾을 수 없습니다.' }

  const draft = buildCardPosting(exp as unknown as CardExpenseForPosting, payableId, cardCompanyVendorId)
  if ('error' in draft) {
    await unpostJournal(admin, 'card', expenseId)
    return { error: draft.error }
  }
  const res = await postJournal(admin, draft)
  return 'error' in res ? res : { ok: true }
}
