import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { classifyByKeywords, suggestCardSettlements } from '@/lib/classifier.server'

// POST /api/transactions/classify
// body: { upload_log_id?: string, bank_account_id?: string }  — 없으면 미분류 전체 처리
// 순서: ① 카드정산 추천(전용 패턴 + 카드사 플래그, 우선) → ② 키워드 분류
//        먼저 걸린 추천은 이후 단계가 덮어쓰지 않는다(미추천 건만 처리).
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const uploadLogId: string | undefined = body.upload_log_id
  const bankAccountId: string | undefined = body.bank_account_id

  const settlements = await suggestCardSettlements(admin, uploadLogId, bankAccountId)
  const result = await classifyByKeywords(admin, uploadLogId, bankAccountId)

  return NextResponse.json({
    ...result,
    card_settlements: settlements,
    message: `키워드 ${result.classified}건 · 카드정산 ${settlements.suggested}건(확신 ${settlements.high}/검토 ${settlements.medium}) 추천 완료`,
  })
}
