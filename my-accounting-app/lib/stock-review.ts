import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isStockMissing, loadLots, loadMoves, STOCK_MIGRATION_HINT, stockPrecheck, syncOrderStock, type StockLot, type StockMove } from '@/lib/stock'
import { writeEditLogs, type Editor } from '@/lib/orders-portal'

// 재고 관리 › 확인 필요 탭 (2차, 1401 — docs/inventory-track.md)
// 시스템은 찾아서 보여주고, 처리는 사람이 한다.
//  ① 재고 있음 · 새로 매입: 선매입 재고가 남아 있던 날 같은 품목을 재고 칸 "없음"으로 넣은 행 — 매입가가 두 번 잡혔을 수 있다
//     처리: [재고 출고로 바꾸기](사유 + 주문 변경 이력, 원 행 취소 + 새 행) / [맞음(실제 새로 매입)](1401 기록 — 다시 안 뜸)
//  ② 재고 원가 미배정: 재고 출고 행인데 저장 때 재고가 모자라 원가가 없는 행 — 처리: [다시 배정]
//  ③ 실사 차이: 실사 수량 ≠ 전산 재고인데 아직 조정 행이 없는 실사 — 처리: [조정 기록](사유)

export const REVIEW_MIGRATION_HINT =
  '1401 마이그레이션(재고 확인 기록)이 아직 적용되지 않았습니다. Supabase SQL 편집기에서 실행해 주세요.'

const chunk = <T,>(arr: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o }
const lotKey = (l: { lot_item_id: string | null; lot_adjust_id: string | null }) => (l.lot_item_id ?? l.lot_adjust_id) as string

/** 품목 하나의 그날 말 전산 재고 */
export function stockQtyAt(lots: StockLot[], moves: StockMove[], productId: string, date: string): number {
  const gone = new Map<string, number>()
  for (const m of moves) {
    if (m.product_id !== productId || m.move_date > date) continue
    const k = (m.lot_item_id ?? m.lot_adjust_id) as string
    gone.set(k, (gone.get(k) ?? 0) + m.quantity)
  }
  let qty = 0
  for (const l of lots) {
    if (l.product_id !== productId || l.lot_date > date) continue
    qty += Math.max(0, l.quantity - (gone.get(lotKey(l)) ?? 0))
  }
  return qty
}

export interface NewBuyRow {
  item_id: string; order_id: string; order_no: string; order_date: string; line_no: number
  customer: string; product_id: string; item_name: string; quantity: number; purchase_total: number
  stock_at_date: number; po_sent: boolean
}
export interface PendingOutRow {
  item_id: string; order_id: string; order_no: string; order_date: string; line_no: number
  customer: string; item_name: string; quantity: number; stock_now: number
}
export interface TakeDiffRow {
  stocktake_id: string; take_date: string; product_id: string; item_name: string
  counted_qty: number; computed_qty: number; diff: number; staff_name: string | null
}

export async function loadReview(admin: SupabaseClient): Promise<
  { newBuy: NewBuyRow[]; pendingOut: PendingOutRow[]; takeDiff: TakeDiffRow[]; marks1401: boolean } | { error: string; migration?: boolean }
> {
  const [lots, moves] = await Promise.all([loadLots(admin), loadMoves(admin)])
  if ('error' in lots) return isStockMissing(lots.error) ? { error: STOCK_MIGRATION_HINT, migration: true } : { error: lots.error }
  if ('error' in moves) return { error: moves.error }

  const stocked = Array.from(new Set(lots.data.map(l => l.product_id)))
  const firstLot = new Map<string, string>()
  for (const l of lots.data) if (!firstLot.has(l.product_id) || l.lot_date < firstLot.get(l.product_id)!) firstLot.set(l.product_id, l.lot_date)

  // 품목 이름
  const names = new Map<string, string>()
  for (const ch of chunk(stocked, 150)) {
    const { data } = await admin.from('erp_products').select('id, item_name').in('id', ch)
    for (const p of data ?? []) names.set(p.id as string, p.item_name as string)
  }

  type ItemRow = { id: string; order_id: string; line_no: number; product_id: string; item_name: string | null; quantity: number
    purchase_total: number | null; stock_role: string | null; stock_cost: number | null; is_canceled: boolean; is_prepayment: boolean
    erp_orders: { order_no: string; order_date: string; canceled_at: string | null; bank_name: string | null; branch_name: string | null } }
  const ITEM_SEL = 'id, order_id, line_no, product_id, item_name, quantity, purchase_total, stock_role, stock_cost, is_canceled, is_prepayment, erp_orders!inner(order_no, order_date, canceled_at, bank_name, branch_name)'   // 품목 행 + 주문 (임베드 타입 추론을 끄려고 '*' 로 넘긴다)
  const items: ItemRow[] = []
  for (const ch of chunk(stocked, 100)) {
    const r = await fetchAllRows<ItemRow>((f, t) => admin.from('erp_order_items')
      .select(ITEM_SEL as '*')
      .in('product_id', ch).eq('is_canceled', false).order('id').range(f, t))
    if ('error' in r) return { error: r.error }
    items.push(...r.data.filter(it => !it.erp_orders.canceled_at))
  }
  const customer = (o: ItemRow['erp_orders']) => [o.bank_name, o.branch_name].filter(Boolean).join(' ')

  // 이미 "맞음" 처리한 행 (1401)
  let marks1401 = true
  const marked = new Set<string>()
  const cand = items.filter(it => !it.stock_role && !it.is_prepayment && it.erp_orders.order_date >= (firstLot.get(it.product_id) ?? '9999'))
  for (const ch of chunk(cand.map(c => c.id), 150)) {
    const { data, error } = await admin.from('erp_stock_review_marks').select('order_item_id').in('order_item_id', ch)
    if (error) { marks1401 = false; break }
    for (const m of data ?? []) marked.add(m.order_item_id as string)
  }
  // 발주서가 이미 나간 행 (재고 출고로 바꾸면 매입처 쪽과 어긋난다 — 화면에서 경고)
  const poSent = new Set<string>()
  for (const ch of chunk(cand.map(c => c.id), 150)) {
    const { data } = await admin.from('erp_purchase_order_items').select('order_item_id, erp_purchase_orders!inner(status)')
      .in('order_item_id', ch).eq('erp_purchase_orders.status', 'active')
    for (const p of data ?? []) poSent.add(p.order_item_id as string)
  }

  const newBuy: NewBuyRow[] = []
  for (const it of cand) {
    if (marked.has(it.id)) continue
    const qty = stockQtyAt(lots.data, moves.data, it.product_id, it.erp_orders.order_date)
    if (qty <= 0) continue
    newBuy.push({
      item_id: it.id, order_id: it.order_id, order_no: it.erp_orders.order_no, order_date: it.erp_orders.order_date, line_no: it.line_no,
      customer: customer(it.erp_orders), product_id: it.product_id, item_name: it.item_name ?? names.get(it.product_id) ?? '',
      quantity: it.quantity, purchase_total: Number(it.purchase_total) || 0, stock_at_date: qty, po_sent: poSent.has(it.id),
    })
  }

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  // 재고 원가 미배정 출고 행 — 재고가 없는 품목도 잡히도록 따로 조회
  const po = await fetchAllRows<ItemRow>((f, t) => admin.from('erp_order_items')
    .select(ITEM_SEL as '*')
    .eq('stock_role', 'out').eq('is_canceled', false).is('stock_cost', null).order('id').range(f, t))
  if ('error' in po) return { error: po.error }
  const pendingOut: PendingOutRow[] = po.data.filter(it => !it.erp_orders.canceled_at).map(it => ({
    item_id: it.id, order_id: it.order_id, order_no: it.erp_orders.order_no, order_date: it.erp_orders.order_date, line_no: it.line_no,
    customer: customer(it.erp_orders), item_name: it.item_name ?? '', quantity: it.quantity,
    stock_now: it.product_id ? stockQtyAt(lots.data, moves.data, it.product_id, today) : 0,
  }))

  // 실사 차이 — 조정 행이 아직 없는 것
  const tk = await fetchAllRows<{ id: string; take_date: string; product_id: string; counted_qty: number; computed_qty: number; staff_name: string | null }>((f, t) =>
    admin.from('erp_stock_stocktakes').select('id, take_date, product_id, counted_qty, computed_qty, staff_name').order('id').range(f, t))
  if ('error' in tk) return { error: tk.error }
  const diffs = tk.data.filter(t => t.counted_qty !== t.computed_qty)
  const resolved = new Set<string>()
  for (const ch of chunk(diffs.map(d => d.id), 150)) {
    const { data } = await admin.from('erp_stock_adjustments').select('stocktake_id').in('stocktake_id', ch).is('canceled_at', null)
    for (const a of data ?? []) resolved.add(a.stocktake_id as string)
  }
  const takeDiff: TakeDiffRow[] = diffs.filter(d => !resolved.has(d.id)).map(d => ({
    stocktake_id: d.id, take_date: d.take_date, product_id: d.product_id, item_name: names.get(d.product_id) ?? '',
    counted_qty: d.counted_qty, computed_qty: d.computed_qty, diff: d.counted_qty - d.computed_qty, staff_name: d.staff_name,
  }))

  const byDate = (a: { order_date?: string; take_date?: string }, b: typeof a) => (b.order_date ?? b.take_date ?? '').localeCompare(a.order_date ?? a.take_date ?? '')
  return { newBuy: newBuy.sort(byDate), pendingOut: pendingOut.sort(byDate), takeDiff: takeDiff.sort(byDate), marks1401 }
}

/** ① [맞음(실제 새로 매입)] — 확인 기록만 남긴다 (주문 행 무수정) */
export async function confirmNewPurchase(admin: SupabaseClient, itemId: string, reason: string, editor: Editor): Promise<string | null> {
  const { error } = await admin.from('erp_stock_review_marks').upsert({
    order_item_id: itemId, decision: 'new_purchase', reason: reason || null,
    employee_id: editor.employeeId, employee_name: editor.employeeName,
  }, { onConflict: 'order_item_id', ignoreDuplicates: true })
  if (error) return /erp_stock_review_marks/.test(error.message) ? REVIEW_MIGRATION_HINT : error.message
  return null
}

/**
 * ① [재고 출고로 바꾸기] — 저장된 주문 행 수정이라 사유 필수 + 주문 변경 이력.
 * 원 행은 취소(이력으로 남김)하고 같은 내용의 재고 출고 행을 같은 자리에 새로 등록 → 선입선출 배정.
 * 발주서가 이미 나간 행은 막는다(매입처가 보내 올 물건이라 실제로는 새로 매입한 것 — 발주서를 먼저 취소해야 한다).
 */
export async function convertToStockOut(admin: SupabaseClient, itemId: string, reason: string, editor: Editor): Promise<{ warning: string | null } | { error: string; status?: number }> {
  if (!reason.trim()) return { error: '바꾸는 사유를 적어 주세요.', status: 400 }
  const { data: it, error } = await admin.from('erp_order_items').select('*').eq('id', itemId).maybeSingle()
  if (error || !it) return { error: '주문 행을 찾을 수 없습니다.', status: 404 }
  if (it.is_canceled) return { error: '이미 취소된 행입니다.', status: 409 }
  if (it.stock_role) return { error: '이미 재고 칸이 지정된 행입니다.', status: 409 }
  if (!it.product_id) return { error: '품번(품목 관리)이 없는 행은 재고 출고로 바꿀 수 없습니다.', status: 400 }
  if (it.is_prepayment || String(it.item_name ?? '').trim() === 'VIP') return { error: '선결제 · VIP 품목은 재고 칸을 쓸 수 없습니다.', status: 400 }
  const { data: order } = await admin.from('erp_orders').select('id, order_no, canceled_at, source').eq('id', it.order_id).maybeSingle()
  if (!order || order.canceled_at) return { error: '취소된 주문의 행은 바꿀 수 없습니다.', status: 409 }
  if (order.source !== 'direct') return { error: '업로드 주문은 바꿀 수 없습니다(원본 보존).', status: 403 }

  const { data: po } = await admin.from('erp_purchase_order_items').select('id, erp_purchase_orders!inner(status, po_no)')
    .eq('order_item_id', itemId).eq('erp_purchase_orders.status', 'active')
  if (po?.length) {
    const no = ((po[0] as Record<string, unknown>).erp_purchase_orders as { po_no?: string } | null)?.po_no ?? ''
    return { error: `발주서${no ? ` ${no}` : ''}가 이미 나간 행입니다 — 매입처가 보내 올 물건이면 실제로 새로 매입한 것입니다. 재고에서 보낼 거면 발주서를 먼저 취소한 뒤 바꿔 주세요.`, status: 409 }
  }

  // 남은 재고 검사 (이 행 수량만큼)
  const block = await stockPrecheck(admin, [{ product_id: it.product_id, item_name: it.item_name ?? '', quantity: Number(it.quantity) || 0, stock_role: 'out' }])
  if (block) return { error: block, status: 409 }

  // 원 행 취소 → 1000번대로 이동 (applyOrderEdit 과 같은 규칙)
  const { count: canceledCnt } = await admin.from('erp_order_items').select('id', { count: 'exact', head: true })
    .eq('order_id', it.order_id).eq('is_canceled', true)
  const { error: cErr } = await admin.from('erp_order_items')
    .update({ is_canceled: true, line_no: 1000 + (canceledCnt ?? 0), line_outstanding: 0 }).eq('id', itemId)
  if (cErr) return { error: `행 취소 실패: ${cErr.message}` }

  const keep = { ...it } as Record<string, unknown>
  for (const k of ['id', 'created_at', 'updated_at', 'is_canceled', 'stock_cost']) delete keep[k]
  const newRow = {
    ...keep, line_no: it.line_no, is_canceled: false, stock_role: 'out',
    purchase_price: 0, purchase_shipping: 0, purchase_total: 0,
    ...('purchase_discount' in it ? { purchase_discount: 0, purchase_discount_mode: '정액', purchase_discount_unit: 0 } : {}),
  }
  const { error: iErr } = await admin.from('erp_order_items').insert(newRow)
  if (iErr) {
    await admin.from('erp_order_items').update({ is_canceled: false, line_no: it.line_no, line_outstanding: it.line_outstanding }).eq('id', itemId)   // 되돌림
    return { error: `새 행 등록 실패: ${iErr.message}` }
  }
  const warn = await syncOrderStock(admin, it.order_id as string)
  const logWarn = await writeEditLogs(admin, it.order_id as string, editor, [{
    field: '재고 출고로 바꾸기',
    before: `${it.item_name ?? ''} ×${it.quantity} (매입합계 ${Number(it.purchase_total ?? 0).toLocaleString('ko-KR')}원)`,
    after: `재고 출고 — 사유: ${reason.trim()}`,
  }])
  await admin.from('erp_orders').update({ last_edited_at: new Date().toISOString() }).eq('id', it.order_id as string)
  return { warning: [warn, logWarn].filter(Boolean).join(' / ') || null }
}

/** ③ 실사 입력 — 그날 말 전산 재고 사본을 함께 남긴다 (차이 해소는 조정 행) */
export async function saveStocktake(admin: SupabaseClient, input: { product_id: string; take_date: string; counted_qty: number; note: string | null }, editor: Editor)
  : Promise<{ diff: number; computed: number } | { error: string; status?: number }> {
  const [lots, moves] = await Promise.all([loadLots(admin, [input.product_id]), loadMoves(admin, [input.product_id])])
  if ('error' in lots) return { error: lots.error }
  if ('error' in moves) return { error: moves.error }
  const computed = stockQtyAt(lots.data, moves.data, input.product_id, input.take_date)
  const { error } = await admin.from('erp_stock_stocktakes').insert({
    take_date: input.take_date, product_id: input.product_id, counted_qty: input.counted_qty, computed_qty: computed,
    employee_id: editor.employeeId, staff_name: editor.employeeName, note: input.note,
  })
  if (error) return /duplicate|unique/i.test(error.message)
    ? { error: '같은 날 이 품목 실사가 이미 있습니다. 날짜를 바꾸거나 확인 필요 탭에서 처리해 주세요.', status: 409 }
    : { error: error.message }
  return { diff: input.counted_qty - computed, computed }
}

/** ③ [조정 기록] — 실사 차이를 조정 행으로. + 는 가장 최근 입고 단가로 입고분, − 는 선입선출 차감 */
export async function adjustFromStocktake(admin: SupabaseClient, stocktakeId: string, reason: string, editor: Editor): Promise<string | null> {
  if (!reason.trim()) return '조정 사유를 적어 주세요.'
  const { data: tk } = await admin.from('erp_stock_stocktakes').select('*').eq('id', stocktakeId).maybeSingle()
  if (!tk) return '실사 기록을 찾을 수 없습니다.'
  const diff = Number(tk.counted_qty) - Number(tk.computed_qty)
  if (!diff) return '차이가 없는 실사입니다.'
  const { count } = await admin.from('erp_stock_adjustments').select('id', { count: 'exact', head: true }).eq('stocktake_id', stocktakeId).is('canceled_at', null)
  if ((count ?? 0) > 0) return '이미 조정 기록이 있는 실사입니다.'
  let unitCost: number | null = null
  if (diff > 0) {
    const lots = await loadLots(admin, [tk.product_id as string])
    if ('error' in lots) return lots.error
    const last = lots.data.filter(l => l.lot_date <= (tk.take_date as string)).pop() ?? lots.data[lots.data.length - 1]
    if (!last) return '이 품목은 입고 기록이 없어 늘어난 수량의 단가를 정할 수 없습니다.'
    unitCost = last.unit_cost
  }
  const { data: adj, error } = await admin.from('erp_stock_adjustments').insert({
    product_id: tk.product_id, adjust_date: tk.take_date, quantity: diff, unit_cost: unitCost, kind: 'stocktake',
    reason: reason.trim(), stocktake_id: stocktakeId, employee_id: editor.employeeId, staff_name: editor.employeeName,
  }).select('id').single()
  if (error || !adj) return error?.message ?? '조정 저장 실패'
  if (diff < 0) {
    const { data: ok, error: rErr } = await admin.rpc('erp_stock_allocate_adjust', { p_adjust_id: adj.id })
    if (rErr || ok !== true) {
      await admin.from('erp_stock_adjustments').update({
        canceled_at: new Date().toISOString(), canceled_by: editor.employeeId, cancel_reason: '배정 실패(남은 재고 부족)',
      }).eq('id', adj.id)
      return '지금 남은 재고가 줄일 수량보다 적어 조정하지 못했습니다 — 실사 뒤 출고가 있었는지 확인해 주세요.'
    }
  }
  return null
}
