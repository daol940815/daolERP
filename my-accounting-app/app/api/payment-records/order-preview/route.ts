import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadOrderPreview } from '@/lib/payment-overview'

export const dynamic = 'force-dynamic'

// 주문 미리보기 (2026-11-18) — 결제 확인 화면에서 주문번호를 누르면 뜨는 보기 전용 창. 매입가 · 마진은 내려보내지 않는다.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  const r = await loadOrderPreview(createAdminClient(), id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 404 })
  return NextResponse.json(r)
}
