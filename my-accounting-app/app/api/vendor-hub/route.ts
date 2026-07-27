import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildHubList } from '@/lib/vendor-hub'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/vendor-hub?from=YYYY-MM-DD&to=YYYY-MM-DD
// 매출처 허브 목록 — 기간 매출·수금·미수·담당·상태
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}
