import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { supplyOfStock, type StockRole } from '@/lib/stock-cost'

// 선매입 재고 — 서버 공용 (재고 관리 트랙 1400, docs/inventory-track.md)
//
// 원본 = 주문 품목 행(선매입 입고 · 재고 출고) + 조정 · 실사. 재고 수량 · 금액은 저장하지 않고 계산한다.
//  - 입고분(lot)  = 유효한 선매입 입고 행(또는 + 조정). 단가 = 그 행 매입합계 ÷ 수량(부가세 포함).
//  - 배정(move)   = 재고 출고 행(또는 − 조정)이 어느 입고분에서 몇 개를 얼마에 가져갔는지(선입선출, DB 함수가 품목별 잠금 아래 계산).
//  - 가져간 쪽이 취소되면(행 취소 · 주문 취소) 배정은 이력으로 남고 계산에서 빠진다 → 재고 자동 복귀.
// 주문 저장 흐름: validateOrderInput → stockPrecheck(저장 전 차단) → 저장 → syncOrderStock(입고분 옮기기 · 원가 승계 · 새 배정).

export const STOCK_MIGRATION_HINT =
  '1400 마이그레이션(재고 관리)이 아직 적용되지 않았습니다. Supabase SQL 편집기에서 실행한 뒤 재고 칸을 써 주세요.'
export const isStockMissing = (msg: string | null | undefined) =>
  /stock_role|stock_cost|erp_stock|v_erp_stock/i.test(msg ?? '')

export interface StockLot {
  lot_item_id: string | null
  lot_adjust_id: string | null
  product_id: string
  lot_date: string
  created_at: string
  quantity: number
  unit_cost: number
  order_id: string | null
  order_no: string | null
  line_no: number | null
  used_qty: number
  remaining_qty: number
}
export interface StockMove {
  id: string
  out_item_id: string | null
  adjust_id: string | null
  lot_item_id: string | null
  lot_adjust_id: string | null
  quantity: number
  unit_cost: number
  amount: number
  product_id: string
  move_date: string
  out_order_id: string | null
  moved_from_item_id: string | null
}

const lotKey = (l: { lot_item_id: string | null; lot_adjust_id: string | null }) => (l.lot_item_id ?? l.lot_adjust_id) as string

const chunk = <T,>(arr: T[], n: number) => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** 입고분 (선입선출 순). productIds 없으면 전체 */
export async function loadLots(admin: SupabaseClient, productIds?: string[]): Promise<{ data: StockLot[] } | { error: string }> {
  const norm = (r: Record<string, unknown>): StockLot => ({
    ...(r as unknown as StockLot),
    quantity: Number(r.quantity) || 0, unit_cost: Number(r.unit_cost) || 0,
    used_qty: Number(r.used_qty) || 0, remaining_qty: Number(r.remaining_qty) || 0,
  })
  const sel = 'lot_item_id, lot_adjust_id, product_id, lot_date, created_at, quantity, unit_cost, order_id, order_no, line_no, used_qty, remaining_qty'
  const groups = productIds ? chunk(Array.from(new Set(productIds)), 150) : [null]
  const out: StockLot[] = []
  for (const g of groups) {
    if (g && !g.length) continue
    const r = await fetchAllRows<Record<string, unknown>>((f, t) => {
      let q = admin.from('v_erp_stock_lots').select(sel)
      if (g) q = q.in('product_id', g)
      return q.order('lot_date').order('created_at').order('lot_item_id', { nullsFirst: false }).order('lot_adjust_id').range(f, t)
    })
    if ('error' in r) return { error: r.error }
    out.push(...r.data.map(norm))
  }
  out.sort((a, b) => a.lot_date.localeCompare(b.lot_date) || a.created_at.localeCompare(b.created_at) || lotKey(a).localeCompare(lotKey(b)))
  return { data: out }
}

/** 유효 배정 (가져간 쪽이 살아 있는 것) */
export async function loadMoves(admin: SupabaseClient, productIds?: string[]): Promise<{ data: StockMove[] } | { error: string }> {
  const sel = 'id, out_item_id, adjust_id, lot_item_id, lot_adjust_id, quantity, unit_cost, amount, product_id, move_date, out_order_id, moved_from_item_id'
  const groups = productIds ? chunk(Array.from(new Set(productIds)), 150) : [null]
  const out: StockMove[] = []
  for (const g of groups) {
    if (g && !g.length) continue
    const r = await fetchAllRows<Record<string, unknown>>((f, t) => {
      let q = admin.from('v_erp_stock_moves').select(sel)
      if (g) q = q.in('product_id', g)
      return q.order('id').range(f, t)
    })
    if ('error' in r) return { error: r.error }
    out.push(...r.data.map(x => ({
      ...(x as unknown as StockMove),
      quantity: Number(x.quantity) || 0, unit_cost: Number(x.unit_cost) || 0, amount: Number(x.amount) || 0,
    })))
  }
  return { data: out }
}

/** 품목별 남은 재고 (주문 입력 안내용) */
export async function remainingByProduct(admin: SupabaseClient, productIds: string[]) {
  const lots = await loadLots(admin, productIds)
  if ('error' in lots) return lots
  const map = new Map<string, { qty: number; lots: { date: string; order_no: string | null; remaining: number; unit_cost: number }[] }>()
  for (const l of lots.data) {
    if (l.remaining_qty <= 0) continue
    const m = map.get(l.product_id) ?? { qty: 0, lots: [] }
    m.qty += l.remaining_qty
    m.lots.push({ date: l.lot_date, order_no: l.order_no, remaining: l.remaining_qty, unit_cost: l.unit_cost })
    map.set(l.product_id, m)
  }
  return { data: map }
}

interface StockLine { product_id?: string | null; item_name: string; quantity: number; stock_role?: StockRole | null }

/**
 * 저장 전 차단 검사.
 *  - 재고 출고 수량이 남은 재고보다 많으면 차단
 *  - 수정 · 재발행으로 빠지는 선매입 입고 행이 이미 (다른 주문에서) 출고됐으면, 새 입고 수량이 그만큼은 남아야 한다
 * excludeOrderIds = 지금 고치는 주문(수정) · 취소될 원본(재발행) — 그 주문의 입고 · 출고는 새 입력으로 바뀐다고 보고 계산한다.
 */
export async function stockPrecheck(
  admin: SupabaseClient,
  items: StockLine[],
  excludeOrderIds: string[] = [],
): Promise<string | null> {
  const stockItems = items.filter(it => it.stock_role)
  const excl = new Set(excludeOrderIds.filter(Boolean))
  if (!stockItems.length && !excl.size) return null

  // 대상 품목: 새 입력의 재고 행 품목 + 빠지는 주문의 재고 행 품목
  const productIds = new Set(stockItems.map(it => it.product_id).filter(Boolean) as string[])
  if (excl.size) {
    const { data, error } = await admin.from('erp_order_items')
      .select('product_id').in('order_id', Array.from(excl)).not('stock_role', 'is', null).eq('is_canceled', false)
    if (error) return isStockMissing(error.message) ? (stockItems.length ? STOCK_MIGRATION_HINT : null) : `재고 확인 실패: ${error.message}`
    for (const r of data ?? []) if (r.product_id) productIds.add(r.product_id as string)
  }
  if (!productIds.size) return null

  const [lots, moves] = await Promise.all([loadLots(admin, Array.from(productIds)), loadMoves(admin, Array.from(productIds))])
  if ('error' in lots) return isStockMissing(lots.error) ? (stockItems.length ? STOCK_MIGRATION_HINT : null) : `재고 확인 실패: ${lots.error}`
  if ('error' in moves) return `재고 확인 실패: ${moves.error}`

  const exclLotKeys = new Set(lots.data.filter(l => l.order_id && excl.has(l.order_id)).map(lotKey))
  const nameOf = new Map<string, string>()
  for (const it of items) if (it.product_id && !nameOf.has(it.product_id)) nameOf.set(it.product_id, it.item_name)

  for (const pid of Array.from(productIds)) {
    const newIn = stockItems.filter(it => it.product_id === pid && it.stock_role === 'in').reduce((s, it) => s + it.quantity, 0)
    const newOut = stockItems.filter(it => it.product_id === pid && it.stock_role === 'out').reduce((s, it) => s + it.quantity, 0)
    const otherLots = lots.data.filter(l => l.product_id === pid && !(l.order_id && excl.has(l.order_id)))
    const otherMoves = moves.data.filter(m => m.product_id === pid && !(m.out_order_id && excl.has(m.out_order_id)))
    const lotQty = otherLots.reduce((s, l) => s + l.quantity, 0) + newIn
    const used = otherMoves.reduce((s, m) => s + m.quantity, 0)
    const avail = lotQty - used
    const name = nameOf.get(pid) ?? '품목'

    // 빠지는 입고분을 다른 주문(또는 조정)이 이미 가져갔으면 새 입고 수량이 그만큼은 있어야 한다
    const takenFromExcl = otherMoves.filter(m => exclLotKeys.has((m.lot_item_id ?? m.lot_adjust_id) as string)).reduce((s, m) => s + m.quantity, 0)
    if (takenFromExcl > newIn) {
      return `선매입 입고 "${name}"은(는) 이미 ${takenFromExcl.toLocaleString('ko-KR')}개가 다른 주문에서 재고 출고되었습니다 — `
        + `입고 수량을 ${takenFromExcl.toLocaleString('ko-KR')}개보다 적게 줄이거나 취소할 수 없습니다. 먼저 출고한 주문 쪽을 정리해 주세요.`
    }
    if (newOut > 0 && newOut > avail) {
      const left = Math.max(0, avail)
      return `재고 출고 "${name}" ${newOut.toLocaleString('ko-KR')}개가 남은 선매입 재고 ${left.toLocaleString('ko-KR')}개보다 많습니다 — `
        + `수량을 줄이거나, 초과분 ${(newOut - left).toLocaleString('ko-KR')}개는 행을 나눠 재고 칸 "없음"(새로 매입)으로 넣어 주세요.`
    }
  }
  return null
}

/**
 * 주문 저장 뒤 재고 맞추기 (생성 · 당일 수정 · 재발행 공용).
 *  released = 이번 저장에서 취소된 행 id (수정의 바뀐 행 · 재발행 원본의 전 행)
 *  1) 취소된 선매입 입고 행에 걸린 유효 배정 → 이 주문의 같은 품목 입고 행으로 옮긴다(단가 · 원가 그대로, moved_from 기록)
 *  2) 취소된 재고 출고 행의 배정 → 같은 품목 · 같은 수량의 새 출고 행으로 넘긴다(재고 원가 불변, 이중 배정 방지)
 *  3) 남은 미배정 출고 행 → DB 함수가 선입선출 배정 + 재고 원가 고정
 * 반환: 경고 문구(저장은 된 상태) 또는 null
 */
export async function syncOrderStock(
  admin: SupabaseClient,
  orderId: string,
  released: string[] = [],
): Promise<string | null> {
  const { data: rows, error } = await admin.from('erp_order_items')
    .select('id, order_id, line_no, product_id, quantity, stock_role, stock_cost, is_canceled, item_name')
    .eq('order_id', orderId).order('line_no')
  if (error) return isStockMissing(error.message) ? null : `재고 반영 실패: ${error.message}`
  const active = (rows ?? []).filter(r => !r.is_canceled && r.stock_role)

  let relRows: Record<string, unknown>[] = []
  if (released.length) {
    for (const ch of chunk(released, 150)) {
      const r = await admin.from('erp_order_items').select('id, product_id, quantity, stock_role, stock_cost').in('id', ch)
      if (r.error) return isStockMissing(r.error.message) ? null : `재고 반영 실패: ${r.error.message}`
      relRows.push(...(r.data ?? []))
    }
    relRows = relRows.filter(r => r.stock_role)
  }
  if (!active.length && !relRows.length) return null
  const warns: string[] = []

  // 1) 입고분 옮기기
  const relIn = relRows.filter(r => r.stock_role === 'in')
  if (relIn.length) {
    const pids = Array.from(new Set(relIn.map(r => r.product_id as string)))
    const moves = await loadMoves(admin, pids)
    if ('error' in moves) return `재고 반영 실패: ${moves.error}`
    const lots = await loadLots(admin, pids)
    if ('error' in lots) return `재고 반영 실패: ${lots.error}`
    for (const pid of pids) {
      const relIds = new Set(relIn.filter(r => r.product_id === pid).map(r => r.id as string))
      const onRel = moves.data.filter(m => m.lot_item_id && relIds.has(m.lot_item_id))
      if (!onRel.length) continue
      const targets = lots.data.filter(l => l.product_id === pid && l.order_id === orderId && l.lot_item_id && l.remaining_qty > 0)
        .map(l => ({ id: l.lot_item_id as string, cap: l.remaining_qty }))
      for (const m of onRel) {
        let left = m.quantity
        let first = true
        for (const t of targets) {
          if (left <= 0) break
          if (t.cap <= 0) continue
          const take = Math.min(left, t.cap)
          if (first && take === m.quantity) {
            await admin.from('erp_stock_allocations').update({ lot_item_id: t.id, moved_from_item_id: m.lot_item_id }).eq('id', m.id)
          } else if (first) {
            await admin.from('erp_stock_allocations').update({
              lot_item_id: t.id, moved_from_item_id: m.lot_item_id, quantity: take, amount: Math.round(take * m.unit_cost),
            }).eq('id', m.id)
          } else {
            await admin.from('erp_stock_allocations').insert({
              out_item_id: m.out_item_id, adjust_id: m.adjust_id, lot_item_id: t.id, moved_from_item_id: m.lot_item_id,
              quantity: take, unit_cost: m.unit_cost, amount: Math.round(take * m.unit_cost),
            })
          }
          first = false
          t.cap -= take
          left -= take
        }
        if (left > 0) warns.push(`선매입 입고분 ${left}개를 옮길 곳이 없습니다 — 재고 관리에서 확인해 주세요.`)
      }
    }
  }

  // 2) 출고 원가 승계 (같은 품목 · 같은 수량)
  const relOut = relRows.filter(r => r.stock_role === 'out')
  if (relOut.length) {
    const { data: allocRows } = await admin.from('erp_stock_allocations').select('id, out_item_id').in('out_item_id', relOut.map(r => r.id as string))
    const hasAlloc = new Set((allocRows ?? []).map(a => a.out_item_id as string))
    const { data: newAlloc } = await admin.from('erp_stock_allocations').select('out_item_id')
      .in('out_item_id', active.filter(r => r.stock_role === 'out').map(r => r.id as string).concat(['00000000-0000-0000-0000-000000000000']))
    const taken = new Set((newAlloc ?? []).map(a => a.out_item_id as string))
    for (const src of relOut) {
      if (!hasAlloc.has(src.id as string)) continue
      const dst = active.find(r => r.stock_role === 'out' && !taken.has(r.id as string)
        && r.product_id === src.product_id && Number(r.quantity) === Number(src.quantity))
      if (!dst) continue
      const { error: mvErr } = await admin.from('erp_stock_allocations').update({ out_item_id: dst.id }).eq('out_item_id', src.id as string)
      if (mvErr) { warns.push(`재고 원가 승계 실패: ${mvErr.message}`); continue }
      await admin.from('erp_order_items').update({ stock_cost: src.stock_cost }).eq('id', dst.id as string)
      taken.add(dst.id as string)
    }
  }

  // 3) 새 배정
  if (active.some(r => r.stock_role === 'out')) {
    const { data, error: rpcErr } = await admin.rpc('erp_stock_allocate_order', { p_order_id: orderId })
    if (rpcErr) {
      warns.push(isStockMissing(rpcErr.message) ? STOCK_MIGRATION_HINT : `재고 원가 계산 실패: ${rpcErr.message}`)
    } else {
      const short = ((data as { short?: { line_no: number; need: number }[] } | null)?.short ?? [])
      if (short.length) {
        warns.push(`재고가 모자라 재고 원가를 계산하지 못한 행이 있습니다(${short.map(s => `${s.line_no}행`).join(', ')}) — `
          + '같은 품목을 동시에 출고했을 수 있습니다. 재고 관리 › 선매입 재고에서 확인해 주세요.')
      }
    }
  }
  return warns.length ? warns.join(' / ') : null
}

/** 주문 전체 취소 전 검사 — 이 주문의 선매입 입고분을 다른 주문(또는 조정)이 이미 가져갔으면 차단 */
export async function stockCancelBlock(admin: SupabaseClient, orderId: string): Promise<string | null> {
  const { data, error } = await admin.from('erp_order_items')
    .select('id, item_name').eq('order_id', orderId).eq('stock_role', 'in').eq('is_canceled', false)
  if (error) return null   // 1400 미적용 — 재고 행 없음
  if (!data?.length) return null
  const { data: mv, error: mErr } = await admin.from('v_erp_stock_moves')
    .select('lot_item_id, quantity, out_order_id').in('lot_item_id', data.map(d => d.id as string))
  if (mErr) return `재고 확인 실패: ${mErr.message}`
  const used = (mv ?? []).filter(m => m.out_order_id !== orderId)
  if (!used.length) return null
  const qty = used.reduce((s, m) => s + (Number(m.quantity) || 0), 0)
  return `이 주문의 선매입 입고분 중 ${qty.toLocaleString('ko-KR')}개가 이미 다른 주문에서 재고 출고되었습니다 — `
    + '출고한 주문을 먼저 정리(재고 칸 변경 · 취소)해야 이 주문을 취소할 수 있습니다. 내용만 바꾸려면 취소·재등록을 이용하세요(입고분이 새 주문으로 옮겨집니다).'
}

/** 그날 말 품목별 선매입 재고 (연말 재고 시트 · 손익 재고 증감 공용) */
export async function stockListAt(admin: SupabaseClient, dates: string[]): Promise<{ data: Map<string, { product_id: string; qty: number; amount: number }[]> } | { error: string }> {
  const [lots, moves] = await Promise.all([loadLots(admin), loadMoves(admin)])
  if ('error' in lots) return lots
  if ('error' in moves) return moves
  const movesByLot = new Map<string, StockMove[]>()
  for (const m of moves.data) {
    const k = (m.lot_item_id ?? m.lot_adjust_id) as string
    movesByLot.set(k, [...(movesByLot.get(k) ?? []), m])
  }
  const out = new Map<string, { product_id: string; qty: number; amount: number }[]>()
  for (const d of dates) {
    const byProduct = new Map<string, { product_id: string; qty: number; amount: number }>()
    for (const l of lots.data) {
      if (l.lot_date > d) continue
      const gone = (movesByLot.get(lotKey(l)) ?? []).filter(m => m.move_date <= d).reduce((s, m) => s + m.quantity, 0)
      const left = Math.max(0, l.quantity - gone)
      if (!left) continue
      const p = byProduct.get(l.product_id) ?? { product_id: l.product_id, qty: 0, amount: 0 }
      p.qty += left
      p.amount += left * l.unit_cost
      byProduct.set(l.product_id, p)
    }
    out.set(d, Array.from(byProduct.values()).map(p => ({ ...p, amount: Math.round(p.amount) })))
  }
  return { data: out }
}

/**
 * 날짜별 선매입 재고 금액 (월별 손익 재고 증감 · 연말 재고).
 * 그날까지 들어온 입고분 수량 − 그날까지 나간 배정 수량 × 입고 단가. 부가세 포함(amount)과 공급가액(supply) 둘 다.
 */
export async function stockValueAt(admin: SupabaseClient, dates: string[]): Promise<{ data: Map<string, { amount: number; supply: number }> } | { error: string }> {
  const list = await stockListAt(admin, dates)
  if ('error' in list) return list
  const out = new Map<string, { amount: number; supply: number }>()
  for (const [d, rows] of Array.from(list.data.entries())) {
    const amount = rows.reduce((s, r) => s + r.amount, 0)
    out.set(d, { amount, supply: supplyOfStock(amount) })
  }
  return { data: out }
}
