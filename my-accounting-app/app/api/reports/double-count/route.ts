import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildDoubleCount } from '@/lib/double-count'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/reports/double-count — 이중계상 상설 검사. 규칙과 계산은 lib/double-count.ts (엑셀 내려받기와 공유).
export async function GET() {
  const admin = createAdminClient()
  const r = await buildDoubleCount(admin)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json(r.result)
}
