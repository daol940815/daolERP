import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { classifyByKeywords } from '@/lib/classifier.server'

// POST /api/transactions/classify
// body: { upload_log_id?: string }  — 없으면 미분류 전체 처리
export async function POST(req: NextRequest) {
  const admin = await createAdminClient()
  const body = await req.json().catch(() => ({}))
  const uploadLogId: string | undefined = body.upload_log_id

  const result = await classifyByKeywords(admin, uploadLogId)

  return NextResponse.json({
    ...result,
    message: `${result.total}건 중 ${result.classified}건 자동 분류 완료`,
  })
}
