import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { applyRevision, buildRevisePlan } from '@/lib/po-revise'

export const dynamic = 'force-dynamic'

// 발주서 '수정 내용 반영' (519, 2026-11-27) — 규칙은 lib/po-revise.ts
// GET  — 반영 계획: 바뀐 줄 · 추천 짝 · 후보 · 근거 발송 기록
// POST { pairs: [{ po_item_id, order_item_id | null }], add_item_ids: string[] } — 직원이 확인한 짝으로 반영

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const plan = await buildRevisePlan(createAdminClient(), params.id)
  if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: plan.status })
  return NextResponse.json(plan)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const body = await req.json().catch(() => null) as {
    pairs?: { po_item_id?: string; order_item_id?: string | null }[]; add_item_ids?: string[]
  } | null
  if (!body || !Array.isArray(body.pairs)) return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  const pairs = body.pairs
    .filter(p => typeof p?.po_item_id === 'string')
    .map(p => ({ po_item_id: p.po_item_id as string, order_item_id: typeof p.order_item_id === 'string' && p.order_item_id ? p.order_item_id : null }))
  const addIds = Array.isArray(body.add_item_ids) ? body.add_item_ids.filter((x): x is string => typeof x === 'string') : []

  const r = await applyRevision(createAdminClient(), params.id, { pairs, add_item_ids: addIds },
    { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
