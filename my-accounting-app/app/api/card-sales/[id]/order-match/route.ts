import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCardOrderState, saveCardOrderMatch } from '@/lib/card-order-match.server'

export const dynamic = 'force-dynamic'

// 카드 결제 → 주문 배분 (2026-11-13)
// GET  /api/card-sales/:id/order-match[?q=주문번호·업체]  — 결제 정보 · 현재 배분 · 후보 주문
// POST body { allocations: [{ order_id, amount }] }          — 배분 저장(교체; 빈 배열 = 전부 해제)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const { id } = await params
  const res = await loadCardOrderState(admin, id, new URL(req.url).searchParams.get('q'))
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 })
  return NextResponse.json(res)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { allocations?: { order_id: string; amount: number }[] }
  const r = await saveCardOrderMatch(admin, id, Array.isArray(body.allocations) ? body.allocations : [])
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  const state = await loadCardOrderState(admin, id)
  return NextResponse.json({ ...r, state: 'error' in state ? null : state })
}
