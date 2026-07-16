import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildVendorLinkStatus } from '@/lib/vendor-link-status'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 거래처 연동 현황 (재정비 4단계) — 대시보드 카드용.
export async function GET() {
  const admin = createAdminClient()
  const status = await buildVendorLinkStatus(admin)
  if ('error' in status) return NextResponse.json({ error: status.error }, { status: 500 })
  return NextResponse.json(status)
}
