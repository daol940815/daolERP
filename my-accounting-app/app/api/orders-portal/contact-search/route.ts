import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { searchCustomers } from '@/lib/contact-search'

export const dynamic = 'force-dynamic'

// 고객 쌍방향 추천 (2026-11-18) — GET ?q=김민수 | ?q=5678 → { hits }
// 상담일지 · 주문서 공용. 권한: 주문 그룹 조회(미들웨어, /api/orders-portal) — 아르바이트도 조회만 가능.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 40)
  const hits = await searchCustomers(createAdminClient(), q)
  return NextResponse.json({ hits })
}
