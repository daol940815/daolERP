import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { confirmCancel } from '@/lib/payment-cancel'
import { syncInvoicesForOrders } from '@/lib/link-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 결제 취소 확정 (1305, 2026-11-18) — 취소 줄을 원본과 매칭한다. 수금 · 정산 작업 수정 권한자.
//   POST 카드   {}                                   → 카드 매출의 취소 행(같은 승인번호)을 확인하고 원 기록의 수금 매칭을 줄인다
//   POST 계산서 { neg_invoice_id, pos_invoice_id }    → 취소 계산서를 주문에 연결하고 원 계산서의 입금을 푼다
const DENY = '결제 취소 확정은 수금 · 정산 작업 수정 권한이 필요합니다. 경영지원팀 오철준 대리 또는 ERP 담당에게 요청해주세요.'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'collections', 'edit')) return NextResponse.json({ error: DENY }, { status: 403 })
  const admin = createAdminClient()
  const r = await confirmCancel(admin, params.id, await req.json().catch(() => ({})), { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  await syncInvoicesForOrders(admin, r.orderIds)   // 주문 수금이 바뀌었으니 남은 계산서의 입금도 맞춘다
  return NextResponse.json(r)
}
