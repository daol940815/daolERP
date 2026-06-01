import type { SupabaseClient } from '@supabase/supabase-js'

// 업로드된 거래에 계정과목 keywords 기반 자동 분류 + 차변/대변 결정 (2단계)
// Step 1: 키워드 매칭 → suggested_account_id
// Step 2: 계정별 방향 규칙(side_on_in / side_on_out) → suggested_side
export async function classifyByKeywords(
  admin: SupabaseClient,
  uploadLogId?: string,
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
  let query = admin
    .from('transactions')
    .select('id, description, amount_in, amount_out')
    .is('suggested_account_id', null)
    .eq('status', 'pending')
    .limit(2000)

  if (uploadLogId) {
    query = query.eq('upload_log_id', uploadLogId)
  }

  const { data: transactions } = await query
  if (!transactions?.length) return { classified: 0, total: 0 }

  let classified = 0

  for (const tx of transactions) {
    const descLower = (tx.description as string).toLowerCase()

    for (const account of accountsWithKw) {
      const matched = (account.keywords as string[]).find((kw: string) =>
        descLower.includes(kw.toLowerCase()),
      )

      if (matched) {
        // Step 2: 계정별 방향 규칙으로 차변/대변 결정
        const isInflow = (tx.amount_in ?? 0) > 0
        const side = isInflow
          ? (account.side_on_in  ?? 'credit')   // 입금 시 방향 (기본: 대변)
          : (account.side_on_out ?? 'debit')     // 출금 시 방향 (기본: 차변)

        await admin
          .from('transactions')
          .update({
            suggested_account_id: account.id,
            suggested_side:       side,
            ai_confidence:        0.8,
            ai_reason:            `키워드 매칭: "${matched}"`,
          })
          .eq('id', tx.id)
        classified++
        break
      }
    }
  }

  return { classified, total: transactions.length }
}
