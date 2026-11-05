import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { prepayBalanceOf } from '@/lib/prepay'

export const dynamic = 'force-dynamic'

// 주문처 선결제 잔액 (주문서 안내용, 2026-11-05) — GET ?vendor_id=
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const vendorId = new URL(req.url).searchParams.get('vendor_id')
  if (!vendorId) return NextResponse.json({ balance: 0, deposit: 0, deduction: 0 })
  return NextResponse.json(await prepayBalanceOf(createAdminClient(), vendorId))
}
