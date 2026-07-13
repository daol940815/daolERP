import type { SupabaseClient } from '@supabase/supabase-js'
import { type JournalDraft } from './types'
import { postJournal, unpostJournal } from './posting'

// 은행거래 자동분개 (업무 규칙). 회계 판단은 전부 여기서 끝나고, 저장은 post_journal(RPC)이 한다.
//
// 규칙(설계: docs/journal-design.md 자동분개 규칙표):
//   입금: (차) 보통예금(은행 GL) / (대) 분류계정
//   출금: (차) 분류계정 / (대) 보통예금(은행 GL)
//   * 거래처(vendor_id)는 손익/상대 계정 라인에 부여(거래처별 원장용). 보통예금 라인엔 부여하지 않음.
//   * 계좌 간 이체(transfer_pair_id)는 v1에서 자동분개 대상 아님(잔액 이동, 손익 무접촉) → 전기 제외.

export interface BankTxForPosting {
  id: string
  tx_date: string
  description: string | null
  amount_in: number | null
  amount_out: number | null
  confirmed_account_id: string | null
  vendor_id: string | null
  transfer_pair_id: string | null
}

export function buildBankPosting(
  tx: BankTxForPosting,
  glAccountId: string,
): JournalDraft | { error: string } {
  if (tx.transfer_pair_id) return { error: '계좌 간 이체는 v1 자동분개 대상이 아닙니다.' }
  if (!tx.confirmed_account_id) return { error: '확정된 계정과목이 없습니다.' }
  if (!glAccountId) return { error: '은행계좌의 GL 계정이 지정되지 않았습니다.' }

  const inflow = (tx.amount_in ?? 0) > 0
  const amount = inflow ? (tx.amount_in ?? 0) : (tx.amount_out ?? 0)
  if (amount <= 0) return { error: '전기할 금액이 없습니다.' }

  const lines = inflow
    ? [
        { account_id: glAccountId,            side: 'debit'  as const, amount, vendor_id: null },
        { account_id: tx.confirmed_account_id, side: 'credit' as const, amount, vendor_id: tx.vendor_id ?? null },
      ]
    : [
        { account_id: tx.confirmed_account_id, side: 'debit'  as const, amount, vendor_id: tx.vendor_id ?? null },
        { account_id: glAccountId,            side: 'credit' as const, amount, vendor_id: null },
      ]

  return {
    source_type: 'bank',
    source_id: tx.id,
    entry_date: tx.tx_date.slice(0, 10),
    description: tx.description,
    entry_type: 'normal',
    lines,
  }
}

// 거래 1건의 분개를 현재 상태에 맞춰 동기화한다(전이 기반, 멱등).
//  - status='confirmed' & 계정 지정 & 이체 아님 → 전기(post)
//  - 그 외(미확정/해제/이체/계정없음)                → 전기 취소(unpost)
export async function syncTransactionJournal(
  admin: SupabaseClient,
  transactionId: string,
): Promise<{ ok: true } | { error: string }> {
  const { data: tx, error } = await admin
    .from('transactions')
    .select('id, tx_date, description, amount_in, amount_out, confirmed_account_id, vendor_id, transfer_pair_id, status, bank_account_id, bank_accounts(gl_account_id)')
    .eq('id', transactionId)
    .single()
  if (error) return { error: error.message }

  const shouldPost =
    tx.status === 'confirmed' &&
    !!tx.confirmed_account_id &&
    !tx.transfer_pair_id &&
    ((tx.amount_in ?? 0) > 0 || (tx.amount_out ?? 0) > 0)

  if (!shouldPost) {
    return unpostJournal(admin, 'bank', transactionId).then(r => ('error' in r ? r : { ok: true as const }))
  }

  // 은행계좌 GL (미지정 시 보통예금 1001 폴백)
  let glAccountId = (tx.bank_accounts as { gl_account_id?: string | null } | null)?.gl_account_id ?? null
  if (!glAccountId) {
    const { data: def } = await admin.from('accounts').select('id').eq('code', '1001').single()
    glAccountId = (def?.id as string | undefined) ?? null
  }
  if (!glAccountId) return { error: '보통예금(1001) 계정을 찾을 수 없습니다.' }

  const draft = buildBankPosting(tx as BankTxForPosting, glAccountId)
  if ('error' in draft) {
    // 전기 불가 사유면 기존 분개는 제거(정합성 유지)
    await unpostJournal(admin, 'bank', transactionId)
    return { error: draft.error }
  }

  const res = await postJournal(admin, draft)
  return 'error' in res ? res : { ok: true }
}
