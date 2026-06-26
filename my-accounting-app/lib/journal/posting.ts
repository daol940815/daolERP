import type { SupabaseClient } from '@supabase/supabase-js'
import { type JournalDraft, draftBalance } from './types'

// Posting Engine 호출 래퍼.
// 회계 판단은 buildPosting(업무 모듈)에서 끝나 있고, 여기서는 RPC(post_journal/unpost_journal)에
// JournalDraft를 그대로 전달한다. 균형 등 최종 검증·채번·저장은 DB(RPC)가 담당한다.

export async function postJournal(
  admin: SupabaseClient,
  draft: JournalDraft,
): Promise<{ id: string } | { error: string }> {
  // 사전 균형 점검 (RPC가 최종 진실이지만, 불필요한 왕복 방지)
  const bal = draftBalance(draft)
  if (!bal.balanced) {
    return { error: `분개 불균형 (차변 ${bal.debit.toLocaleString()} / 대변 ${bal.credit.toLocaleString()})` }
  }

  const { data, error } = await admin.rpc('post_journal', {
    p_source_type: draft.source_type,
    p_source_id: draft.source_id,
    p_entry_date: draft.entry_date,
    p_description: draft.description,
    p_entry_type: draft.entry_type ?? 'normal',
    p_lines: draft.lines.map(l => ({
      account_id: l.account_id,
      side: l.side,
      amount: l.amount,
      vendor_id: l.vendor_id ?? null,
      note: l.note ?? null,
    })),
  })
  if (error) return { error: error.message }
  return { id: data as string }
}

export async function unpostJournal(
  admin: SupabaseClient,
  sourceType: JournalDraft['source_type'],
  sourceId: string,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await admin.rpc('unpost_journal', {
    p_source_type: sourceType,
    p_source_id: sourceId,
  })
  if (error) return { error: error.message }
  return { ok: true }
}
