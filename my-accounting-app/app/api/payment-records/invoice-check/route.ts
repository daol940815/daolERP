import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { loadInvoiceCheck } from '@/lib/payment-guide'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 계산서 확인 (결제 확인 3단계) — 홈택스에 없음 · 금액 다름 · 이체로 받았는데 증빙 없음
// GET /api/payment-records/invoice-check
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const r = await loadInvoiceCheck(createAdminClient())
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  // can_set_billing: 다른 거래처 명의 계산서를 연결하면서 청구처로 지정할 수 있는지(거래처 관리 수정 권한)
  return NextResponse.json({ ...r, can_edit: can(me, 'collections', 'edit'), can_set_billing: can(me, 'customers', 'edit') })
}
