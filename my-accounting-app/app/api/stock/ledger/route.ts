import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadLots, loadMoves } from '@/lib/stock'

export const dynamic = 'force-dynamic'

// GET /api/stock/ledger?product_id= — 선매입 재고 품목 원장 (1400)
// 입고 · 출고 · 조정이 모두 원본(주문 행 · 조정 기록)으로 이어진다. 출고 한 행이 두 입고분에 걸치면 두 줄.
const chunk = <T,>(arr: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o }

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const pid = new URL(req.url).searchParams.get('product_id') ?? ''
  if (!pid) return NextResponse.json({ error: '품목을 골라 주세요.' }, { status: 400 })
  const admin = createAdminClient()
  const [lots, moves, prod] = await Promise.all([
    loadLots(admin, [pid]), loadMoves(admin, [pid]),
    admin.from('erp_products').select('id, item_code, item_name, purchase_vendor_name').eq('id', pid).maybeSingle(),
  ])
  if ('error' in lots) return NextResponse.json({ error: lots.error }, { status: 500 })
  if ('error' in moves) return NextResponse.json({ error: moves.error }, { status: 500 })

  // 원본 주문 행 정보 (입고 행 · 출고 행)
  const itemIds = Array.from(new Set([
    ...lots.data.map(l => l.lot_item_id), ...moves.data.map(m => m.out_item_id),
  ].filter(Boolean) as string[]))
  const itemInfo = new Map<string, Record<string, unknown>>()
  for (const ch of chunk(itemIds, 150)) {
    const { data } = await admin.from('erp_order_items')
      .select('id, line_no, order_kind, order_id, erp_orders!inner(order_no, order_date, bank_name, branch_name, staff_name)').in('id', ch)
    for (const r of (data ?? []) as Record<string, unknown>[]) itemInfo.set(r.id as string, r)
  }
  const adjIds = Array.from(new Set([...lots.data.map(l => l.lot_adjust_id), ...moves.data.map(m => m.adjust_id)].filter(Boolean) as string[]))
  const adjInfo = new Map<string, Record<string, unknown>>()
  if (adjIds.length) {
    const { data } = await admin.from('erp_stock_adjustments').select('id, adjust_date, kind, reason, staff_name').in('id', adjIds)
    for (const r of (data ?? []) as Record<string, unknown>[]) adjInfo.set(r.id as string, r)
  }
  const lotLabel = new Map(lots.data.map(l => [(l.lot_item_id ?? l.lot_adjust_id) as string, `${l.lot_date.slice(5).replace('-', '/')}분`]))
  const ord = (id: string | null) => {
    const r = id ? itemInfo.get(id) : undefined
    const o = (r?.erp_orders ?? null) as { order_no: string; order_date: string; bank_name: string | null; branch_name: string | null; staff_name: string | null } | null
    return { r, o }
  }
  const ADJ_KIND: Record<string, string> = { stocktake: '실사 조정', opening: '기초재고', other: '조정' }

  type Line = { date: string; seq: string; kind: 'in' | 'out' | 'adjust'; order_id: string | null; order_no: string | null; line_no: number | null
    party: string; purpose: string; quantity: number; unit_cost: number; amount: number; lot: string; staff: string | null }
  const lines: Line[] = []
  for (const l of lots.data) {
    const key = (l.lot_item_id ?? l.lot_adjust_id) as string
    if (l.lot_item_id) {
      const { r, o } = ord(l.lot_item_id)
      lines.push({ date: l.lot_date, seq: `${l.created_at}a`, kind: 'in', order_id: (r?.order_id as string) ?? null, order_no: o?.order_no ?? l.order_no,
        line_no: l.line_no, party: [o?.bank_name, o?.branch_name].filter(Boolean).join(' '), purpose: '-',
        quantity: l.quantity, unit_cost: l.unit_cost, amount: Math.round(l.quantity * l.unit_cost), lot: lotLabel.get(key) ?? '', staff: o?.staff_name ?? null })
    } else {
      const a = adjInfo.get(key)
      lines.push({ date: l.lot_date, seq: `${l.created_at}a`, kind: 'adjust', order_id: null, order_no: null, line_no: null,
        party: ADJ_KIND[String(a?.kind)] ?? '조정', purpose: String(a?.reason ?? ''), quantity: l.quantity, unit_cost: l.unit_cost,
        amount: Math.round(l.quantity * l.unit_cost), lot: lotLabel.get(key) ?? '', staff: (a?.staff_name as string) ?? null })
    }
  }
  for (const m of moves.data) {
    const lot = lotLabel.get((m.lot_item_id ?? m.lot_adjust_id) as string) ?? ''
    if (m.out_item_id) {
      const { r, o } = ord(m.out_item_id)
      const kind = String(r?.order_kind ?? '')
      lines.push({ date: m.move_date, seq: `${o?.order_no ?? ''}:${r?.line_no ?? ''}:${m.id}`, kind: 'out', order_id: (r?.order_id as string) ?? null,
        order_no: o?.order_no ?? null, line_no: (r?.line_no as number) ?? null, party: [o?.bank_name, o?.branch_name].filter(Boolean).join(' '),
        purpose: kind === '샘플' ? '샘플' : '판매', quantity: -m.quantity, unit_cost: m.unit_cost, amount: -m.amount, lot, staff: o?.staff_name ?? null })
    } else {
      const a = adjInfo.get(m.adjust_id as string)
      lines.push({ date: m.move_date, seq: `z${m.id}`, kind: 'adjust', order_id: null, order_no: null, line_no: null,
        party: ADJ_KIND[String(a?.kind)] ?? '조정', purpose: String(a?.reason ?? ''), quantity: -m.quantity, unit_cost: m.unit_cost,
        amount: -m.amount, lot, staff: (a?.staff_name as string) ?? null })
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'in' ? -1 : 0) - (b.kind === 'in' ? -1 : 0) || a.seq.localeCompare(b.seq))
  let bal = 0
  const withBal = lines.map(l => { bal += l.quantity; return { ...l, balance: bal } })
  return NextResponse.json({ product: prod.data ?? null, lines: withBal, stock: bal })
}
