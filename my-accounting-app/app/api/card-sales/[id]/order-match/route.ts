import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadCardOrderState, saveCardOrderMatch } from '@/lib/card-order-match.server'
import { resolveReason } from '@/lib/payment-reasons'

export const dynamic = 'force-dynamic'

// 카드 결제 → 주문 배분 (2026-11-13)
// GET  /api/card-sales/:id/order-match[?q=주문번호·업체]  — 결제 정보 · 현재 배분 · 후보 주문
// POST body { allocations: [{ order_id, amount }] }          — 배분 저장(교체; 빈 배열 = 전부 해제)
//      저장 뒤 결제 기록(1300)과 동기화 — 기록과 맞으면 자동 확정 (records_confirmed · records_released 로 알려 준다, 2026-11-16)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const { id } = await params
  const res = await loadCardOrderState(admin, id, new URL(req.url).searchParams.get('q'))
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 })
  return NextResponse.json(res)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const me = await getCurrentUser()
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { allocations?: { order_id: string; amount: number }[]; reason?: unknown }
  // 기존 배분을 풀거나 줄일 때는 사유 필수(1307) — 화면이 그때만 reason 을 보낸다. 보냈으면 항목 검사
  let reason: { code: string; text: string } | null = null
  if (body.reason) {
    const rr = resolveReason('release', body.reason)
    if ('error' in rr) return NextResponse.json({ error: rr.error }, { status: 400 })
    reason = rr
  }
  const r = await saveCardOrderMatch(admin, id, Array.isArray(body.allocations) ? body.allocations : [],
    { employeeId: me?.employeeId ?? null, employeeName: me?.employeeName ?? null }, reason)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  const state = await loadCardOrderState(admin, id)
  return NextResponse.json({ ...r, state: 'error' in state ? null : state })
}
