import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { checkVendorName } from '@/lib/vendor-name-check'

export const dynamic = 'force-dynamic'

// GET /api/vendor-hub/name-check?group=&branch= — 매출처 등록 창의 입력 확인 (2026-11-19 업체명 자동 표준화)
// 표준 업체명 · 지점명 정리 · 저장될 이름 · 연결될 업체 · 이미 있는 매출처. 읽기 전용.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const r = await checkVendorName(createAdminClient(), sp.get('group') ?? '', sp.get('branch') ?? '')
  return NextResponse.json(r)
}
