import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPurchaseHubList } from '@/lib/purchase-hub'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/purchase-hub?from=YYYY-MM-DD&to=YYYY-MM-DD
// 매입처 허브 목록 — 기간 매입·지급·미지급 잔액·담당·상태
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildPurchaseHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}
