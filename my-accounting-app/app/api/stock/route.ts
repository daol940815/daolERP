import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { getCurrentUser } from '@/lib/user-role'
import { isStockMissing, loadLots, loadMoves, STOCK_MIGRATION_HINT } from '@/lib/stock'
import { kstToday } from '@/lib/orders-portal'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// GET /api/stock[?asof=YYYY-MM-DD] — 재고 관리 › 선매입 재고 탭 (1400)
// 재고는 저장값이 아니라 입고분(선매입 입고 행 · + 조정)과 배정(재고 출고 행 · − 조정)에서 계산한다.
// asof = 그날 말 기준(월별 손익 재고 증감 드릴다운). 없으면 오늘.

const OLD_DAYS = 90
const chunk = <T,>(arr: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o }
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const today = kstToday()
  const asofRaw = sp.get('asof') ?? ''
  const asof = /^\d{4}-\d{2}-\d{2}$/.test(asofRaw) ? asofRaw : today
  const monthStart = `${asof.slice(0, 7)}-01`

  const [lots, moves] = await Promise.all([loadLots(admin), loadMoves(admin)])
  if ('error' in lots) {
    if (isStockMissing(lots.error)) return NextResponse.json({ migration1400: false, error: STOCK_MIGRATION_HINT })
    return NextResponse.json({ error: lots.error }, { status: 500 })
  }
  if ('error' in moves) return NextResponse.json({ error: moves.error }, { status: 500 })

  const productIds = Array.from(new Set(lots.data.map(l => l.product_id)))
  const products = new Map<string, { item_code: string | null; item_name: string; purchase_vendor_name: string | null }>()
  for (const ch of chunk(productIds, 150)) {
    const { data } = await admin.from('erp_products').select('id, item_code, item_name, purchase_vendor_name').in('id', ch)
    for (const p of data ?? []) products.set(p.id as string, { item_code: p.item_code as string | null, item_name: p.item_name as string, purchase_vendor_name: p.purchase_vendor_name as string | null })
  }
  // 최근 실사 (그날까지)
  const takes = new Map<string, { take_date: string; counted_qty: number; computed_qty: number }>()
  const tk = await fetchAllRows<{ id: string; take_date: string; product_id: string; counted_qty: number; computed_qty: number }>((f, t) =>
    admin.from('erp_stock_stocktakes').select('id, take_date, product_id, counted_qty, computed_qty').lte('take_date', asof).order('id').range(f, t))
  if (!('error' in tk)) {
    for (const r of tk.data) {
      const cur = takes.get(r.product_id)
      if (!cur || cur.take_date < r.take_date) takes.set(r.product_id, r)
    }
  }
  // 아직 배정 안 된 재고 출고 행 (재고 부족 등) — 확인 필요
  const { count: pendingOut } = await admin.from('erp_order_items').select('id', { count: 'exact', head: true })
    .eq('stock_role', 'out').eq('is_canceled', false).is('stock_cost', null)

  const movesByLot = new Map<string, typeof moves.data>()
  for (const m of moves.data) {
    const k = (m.lot_item_id ?? m.lot_adjust_id) as string
    movesByLot.set(k, [...(movesByLot.get(k) ?? []), m])
  }

  type Row = {
    product_id: string; item_code: string | null; item_name: string; purchase_vendor_name: string | null
    in_qty: number; out_qty: number; adj_qty: number; stock: number; value: number; avg_cost: number
    oldest_date: string | null; oldest_days: number | null
    last_take: { take_date: string; counted_qty: number; computed_qty: number } | null
    lots: { key: string; order_id: string | null; order_no: string | null; line_no: number | null; date: string; quantity: number; unit_cost: number; remaining: number; adjust: boolean }[]
  }
  const rows = new Map<string, Row>()
  let monthIn = 0, monthInCount = 0
  for (const l of lots.data) {
    if (l.lot_date > asof) continue
    const p = products.get(l.product_id)
    let r = rows.get(l.product_id)
    if (!r) {
      r = { product_id: l.product_id, item_code: p?.item_code ?? null, item_name: p?.item_name ?? '(품목 없음)', purchase_vendor_name: p?.purchase_vendor_name ?? null,
        in_qty: 0, out_qty: 0, adj_qty: 0, stock: 0, value: 0, avg_cost: 0, oldest_date: null, oldest_days: null,
        last_take: takes.get(l.product_id) ?? null, lots: [] }
      rows.set(l.product_id, r)
    }
    const key = (l.lot_item_id ?? l.lot_adjust_id) as string
    const lm = (movesByLot.get(key) ?? []).filter(m => m.move_date <= asof)
    const gone = lm.reduce((s, m) => s + m.quantity, 0)
    const remaining = Math.max(0, l.quantity - gone)
    if (l.lot_item_id) r.in_qty += l.quantity; else r.adj_qty += l.quantity
    for (const m of lm) { if (m.out_item_id) r.out_qty += m.quantity; else r.adj_qty -= m.quantity }
    r.value += remaining * l.unit_cost
    if (remaining > 0 && (!r.oldest_date || l.lot_date < r.oldest_date)) r.oldest_date = l.lot_date
    r.lots.push({ key, order_id: l.order_id, order_no: l.order_no, line_no: l.line_no, date: l.lot_date, quantity: l.quantity, unit_cost: l.unit_cost, remaining, adjust: !l.lot_item_id })
    if (l.lot_item_id && l.lot_date >= monthStart) { monthIn += Math.round(l.quantity * l.unit_cost); monthInCount++ }
  }
  let monthOut = 0
  const monthOutItems = new Set<string>()
  for (const m of moves.data) {
    if (m.out_item_id && m.move_date >= monthStart && m.move_date <= asof) { monthOut += m.amount; monthOutItems.add(m.out_item_id) }
  }
  const list = Array.from(rows.values()).map(r => {
    r.stock = r.in_qty + r.adj_qty - r.out_qty
    r.value = Math.round(r.value)
    r.avg_cost = r.stock > 0 ? Math.round(r.value / r.stock) : 0
    r.oldest_days = r.oldest_date ? daysBetween(r.oldest_date, asof) : null
    return r
  }).sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0) || a.item_name.localeCompare(b.item_name, 'ko'))

  return NextResponse.json({
    asof, today, old_days: OLD_DAYS, can_edit: can(me, 'orders', 'edit'),
    rows: list,
    kpi: {
      products_with_stock: list.filter(r => r.stock > 0).length,
      products_total: list.length,
      value: list.reduce((s, r) => s + r.value, 0),
      month_in: monthIn, month_in_count: monthInCount,
      month_out_cost: monthOut, month_out_count: monthOutItems.size,
      old: list.filter(r => r.stock > 0 && (r.oldest_days ?? 0) > OLD_DAYS).length,
      pending_out: pendingOut ?? 0,
    },
  })
}
