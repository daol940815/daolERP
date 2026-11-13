import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { autoMatchReceipts } from '@/lib/cash-receipt-payments.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/cash-receipts/auto-match — body { ids: string[] }
// 선택한 매출 현금영수증에 대해 금액 같음 · 발행일 ±7일 · 미연결 입금 후보가 딱 1건일 때만 자동 연결 (425)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean).slice(0, 500) : []
  if (!ids.length) return NextResponse.json({ error: '대상 현금영수증이 없습니다.' }, { status: 400 })
  return NextResponse.json(await autoMatchReceipts(admin, ids))
}
