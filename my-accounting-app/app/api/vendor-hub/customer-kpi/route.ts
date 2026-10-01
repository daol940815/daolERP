import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/vendor-hub/customer-kpi?year=2026
// 고객관리 집계(신규/이탈·금액대·유형)의 투트랙 분류 플래그 — hub_customer_flags RPC(108).
// RPC 미적용 DB에서는 available:false로 응답해 화면이 섹션을 숨긴다 (105 패턴).
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const yearRaw = new URL(req.url).searchParams.get('year')
  const year = yearRaw ? parseInt(yearRaw, 10) : null

  const { data, error } = await admin.rpc('hub_customer_flags', { p_year: year })
  if (error) {
    // 42883/PGRST202: 함수 없음 (마이그레이션 108 미적용)
    if (/hub_customer_flags/.test(error.message) || error.code === '42883' || error.code === 'PGRST202') {
      return NextResponse.json({ available: false })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ available: true, ...data })
}
