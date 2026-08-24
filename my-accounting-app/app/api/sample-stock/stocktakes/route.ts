import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/sample-stock/stocktakes — 실사 일괄 기록.
// computed_qty(실사 시점 전산재고)는 서버가 원장에서 직접 계산해 스냅샷으로 남긴다.
// 오차 해소는 실사 기록 수정이 아니라 조정(adjust) 원장 행 추가로 한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = (await req.json().catch(() => null)) as {
    take_date?: string
    staff_name?: string
    employee_id?: string
    entries?: { product_id: string; counted_qty: number }[]
  } | null

  const takeDate = body?.take_date
  const entries = (body?.entries ?? []).filter(
    (e) => e.product_id && Number.isInteger(Number(e.counted_qty)) && Number(e.counted_qty) >= 0,
  )
  if (!takeDate) return NextResponse.json({ error: '실사 날짜가 필요합니다.' }, { status: 400 })
  if (!entries.length) return NextResponse.json({ error: '실사 수량이 입력된 품목이 없습니다.' }, { status: 400 })

  // 대상 품목의 전산재고 계산 (원장 전체 합계)
  const movesRes = await fetchAllRows<{ product_id: string | null; move_type: string; quantity: number }>(
    (from, to) =>
      admin
        .from('erp_sample_moves')
        .select('product_id, move_type, quantity')
        .not('product_id', 'is', null)
        .order('id')
        .range(from, to),
  )
  if ('error' in movesRes) return NextResponse.json({ error: movesRes.error }, { status: 500 })
  const computed = new Map<string, number>()
  for (const m of movesRes.data) {
    const cur = computed.get(m.product_id as string) ?? 0
    computed.set(m.product_id as string, cur + (m.move_type === 'out' ? -m.quantity : m.quantity))
  }

  const rows = entries.map((e) => ({
    take_date: takeDate,
    product_id: e.product_id,
    counted_qty: Number(e.counted_qty),
    computed_qty: computed.get(e.product_id) ?? 0,
    staff_name: (body?.staff_name ?? '').trim() || null,
    employee_id: body?.employee_id || null,
  }))

  // 같은 날 같은 품목 재실사는 갱신 (uq_sample_stocktakes_date_product)
  const { error } = await admin
    .from('erp_sample_stocktakes')
    .upsert(rows, { onConflict: 'take_date,product_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const diffs = rows
    .filter((r) => r.counted_qty !== r.computed_qty)
    .map((r) => ({ product_id: r.product_id, counted: r.counted_qty, computed: r.computed_qty }))
  return NextResponse.json({ ok: true, saved: rows.length, diffs })
}
