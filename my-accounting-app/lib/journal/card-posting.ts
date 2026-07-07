import type { SupabaseClient } from '@supabase/supabase-js'
import { type JournalDraft } from './types'
import { postJournal, unpostJournal } from './posting'

// 법인카드 사용 자동분개 (업무 규칙). 저장은 post_journal(RPC)이 담당.
//
// 규칙(설계: docs/journal-design.md):
//   카드 사용: (차) 비용계정(confirmed) [+ 부가세대급금(1102) 세액] / (대) 미지급금(2001) 승인금액
//   취소행(순액 음수, 롯데처럼 취소가 원거래와 별도 행으로 오는 양식):
//     역분개 — (차) 미지급금 / (대) 비용계정 — 로 전기해 원거래 비용을 원장에서 상쇄한다.
//   승인 거절('거절') 건: 실제 청구가 없으므로 금액이 있어도 전기하지 않는다.
//   * 세액(tax_amount)은 카드사 파일 제공값(하나·롯데 등). 없으면(0) 전액 비용 처리.
//   * 카드대금 결제(은행출금)는 별도로 미지급금 차변 처리 → 이중계상 방지(은행 분개에서 처리).
//   * 미지급금(2001)의 상대처(vendor)는 가맹점이 아니라 "카드사"다 — 카드사에 갚을 채무이므로,
//     card_accounts.vendor_id(카드사 거래처)를 미지급금 라인에 태깅한다(거래처별 원장 일관성).

export interface CardExpenseForPosting {
  id: string
  tx_date: string
  merchant_name: string | null
  approved_amount: number | null
  cancel_amount: number | null
  tax_amount: number | null
  statement_status: string | null
  confirmed_account_id: string | null
  classify_status: string
}

// 승인 거절 건은 실제 청구되지 않으므로 금액이 찍혀 있어도 전기 대상이 아니다
// (하나카드 파일은 거절 건에도 시도 금액을 표기한다)
export function isRejectedExpense(statementStatus: string | null): boolean {
  return (statementStatus ?? '').includes('거절')
}

export function buildCardPosting(
  exp: CardExpenseForPosting,
  payableAccountId: string,
  cardCompanyVendorId: string | null,
  vatReceivableId: string | null,
): JournalDraft | { error: string } {
  if (exp.classify_status !== 'confirmed' || !exp.confirmed_account_id) {
    return { error: '확정된 계정과목이 없습니다.' }
  }
  if (!payableAccountId) return { error: '미지급금(2001) 계정이 없습니다.' }
  if (isRejectedExpense(exp.statement_status)) {
    return { error: '승인 거절 건은 전기하지 않습니다.' }
  }
  // 순액 = 승인 - 취소.
  //   양수: 정분개 / 음수(별도 행 취소): 역분개로 원거래 상쇄 / 0(같은 행 전액취소): 전기 없음
  const net = (exp.approved_amount ?? 0) - (exp.cancel_amount ?? 0)
  if (net === 0) return { error: '전기할 금액이 없습니다.' }
  const isReversal = net < 0
  const amount = Math.abs(net)

  // 부가세 분리: 파일 제공 세액이 유효 범위(0 < 세액 < 순액)이고 계정이 있으면 매입세액 분리
  const vat = (vatReceivableId && (exp.tax_amount ?? 0) > 0 && (exp.tax_amount ?? 0) < amount)
    ? (exp.tax_amount ?? 0) : 0
  const main = amount - vat

  // 역분개는 차/대를 반전 — (차) 미지급금 / (대) 비용계정 [+ 부가세대급금 대변]
  const expenseSide = isReversal ? ('credit' as const) : ('debit' as const)
  const payableSide = isReversal ? ('debit' as const) : ('credit' as const)

  const lines = [
    { account_id: exp.confirmed_account_id, side: expenseSide, amount: main, vendor_id: null },
    ...(vat > 0 ? [{ account_id: vatReceivableId!, side: expenseSide, amount: vat, vendor_id: null }] : []),
    // 미지급금: 상대처 = 카드사
    { account_id: payableAccountId, side: payableSide, amount, vendor_id: cardCompanyVendorId },
  ]

  return {
    source_type: 'card',
    source_id: exp.id,
    entry_date: exp.tx_date.slice(0, 10),
    description: isReversal ? `${exp.merchant_name ?? ''} (취소)`.trim() : exp.merchant_name,
    entry_type: 'normal',
    lines,
  }
}

// 카드 사용내역 1건의 분개를 현재 상태에 맞춰 동기화한다(멱등).
//  - classify_status='confirmed' & 계정 지정 & 순액≠0 → 전기(양수 정분개·음수 역분개)
//  - 그 외(미확정/계정해제/순액 0)                       → 전기 취소
export async function syncCardExpenseJournal(
  admin: SupabaseClient,
  expenseId: string,
): Promise<{ ok: true } | { error: string }> {
  const { data: exp, error } = await admin
    .from('card_expenses')
    .select('id, tx_date, merchant_name, approved_amount, cancel_amount, tax_amount, statement_status, confirmed_account_id, classify_status, card_accounts(vendor_id)')
    .eq('id', expenseId)
    .single()
  if (error) return { error: error.message }

  // 미지급금 상대처 = 카드사 거래처 (card_accounts.vendor_id)
  const ca = (exp as { card_accounts?: { vendor_id: string | null } | { vendor_id: string | null }[] | null }).card_accounts
  const cardCompanyVendorId =
    (Array.isArray(ca) ? ca[0]?.vendor_id : ca?.vendor_id) ?? null

  // 순액이 0이 아니면 전기(양수 정분개·음수 역분개), 0이거나 승인 거절이면 전기 취소
  const shouldPost =
    exp.classify_status === 'confirmed' &&
    !!exp.confirmed_account_id &&
    !isRejectedExpense(exp.statement_status as string | null) &&
    (exp.approved_amount ?? 0) - (exp.cancel_amount ?? 0) !== 0

  if (!shouldPost) {
    return unpostJournal(admin, 'card', expenseId).then(r => ('error' in r ? r : { ok: true as const }))
  }

  const { data: accs } = await admin.from('accounts').select('id, code').in('code', ['2001', '1102'])
  const byCode = new Map((accs ?? []).map(a => [a.code as string, a.id as string]))
  const payableId = byCode.get('2001') ?? null
  if (!payableId) return { error: '미지급금(2001) 계정을 찾을 수 없습니다.' }
  const vatReceivableId = byCode.get('1102') ?? null   // 부가세대급금 (없으면 전액 비용)

  const draft = buildCardPosting(exp as unknown as CardExpenseForPosting, payableId, cardCompanyVendorId, vatReceivableId)
  if ('error' in draft) {
    await unpostJournal(admin, 'card', expenseId)
    return { error: draft.error }
  }
  const res = await postJournal(admin, draft)
  return 'error' in res ? res : { ok: true }
}
