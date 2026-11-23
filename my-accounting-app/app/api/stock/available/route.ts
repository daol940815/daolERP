import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { isStockMissing, loadLots, loadMoves } from '@/lib/stock'

export const dynamic = 'force-dynamic'

// GET /api/stock/available?product_ids=a,b[&exclude=주문id] — 주문 입력 화면의 선매입 재고 안내 · 재고 원가 미리보기 (1400)
//  exclude = 지금 고치는 주문(수정) · 취소될 원본(재발행): 그 주문의 출고분은 되돌려 놓고, 그 주문의 입고분은 뺀다(새 입력으로 바뀜).
//  저장 때 서버가 다시 검사 · 계산하므로 여기 값은 안내용이다.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const ids = (sp.get('product_ids') ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 300)
  const exclude = (sp.get('exclude') ?? '').trim() || null
  if (!ids.length) return NextResponse.json({ products: {} })
  const admin = createAdminClient()
  const [lots, moves] = await Promise.all([loadLots(admin, ids), loadMoves(admin, ids)])
  if ('error' in lots) {
    if (isStockMissing(lots.error)) return NextResponse.json({ products: {}, migration1400: false })
    return NextResponse.json({ error: lots.error }, { status: 500 })
  }
  if ('error' in moves) return NextResponse.json({ error: moves.error }, { status: 500 })

  // 제외 주문의 출고분을 입고분별로 되돌린다
  const giveBack = new Map<string, number>()
  if (exclude) {
    for (const m of moves.data) {
      if (m.out_order_id !== exclude) continue
      const k = (m.lot_item_id ?? m.lot_adjust_id) as string
      giveBack.set(k, (giveBack.get(k) ?? 0) + m.quantity)
    }
  }
  const products: Record<string, { qty: number; lots: { date: string; order_no: string | null; remaining: number; unit_cost: number }[] }> = {}
  for (const l of lots.data) {
    if (exclude && l.order_id === exclude) continue
    const remaining = l.remaining_qty + (giveBack.get((l.lot_item_id ?? l.lot_adjust_id) as string) ?? 0)
    if (remaining <= 0) continue
    const p = (products[l.product_id] ??= { qty: 0, lots: [] })
    p.qty += remaining
    p.lots.push({ date: l.lot_date, order_no: l.order_no, remaining, unit_cost: l.unit_cost })
  }
  return NextResponse.json({ products })
}
