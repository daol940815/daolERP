import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIGRATION_MSG = '마이그레이션 800(erp_sample_moves)이 아직 실행되지 않았습니다. SQL 편집기에서 800_sample_stock.sql을 실행해 주세요.'

interface MoveRow {
  id: string
  move_date: string
  move_type: 'in' | 'out' | 'adjust'
  product_id: string | null
  item_name_raw: string | null
  quantity: number
  unit_cost: number | null
  total_cost: number | null
  purpose: 'sales' | 'gift' | null
  staff_name: string | null
  employee_id: string | null
}

interface TakeRow {
  take_date: string
  product_id: string
  counted_qty: number
  computed_qty: number
}

// GET /api/sample-stock — 재고 현황 + 소진 비용 집계에 필요한 데이터 일괄 반환.
// 전산재고는 저장값이 아니라 원장 합계에서 계산한다 (원본데이터 철학).
export async function GET() {
  const admin = createAdminClient()

  // 원장 전체 (range 페이지네이션 — 고유 키 정렬 필수: 중복 값 정렬은 페이지 경계에서 행이 새거나 겹친다)
  const movesRes = await fetchAllRows<MoveRow>((from, to) =>
    admin
      .from('erp_sample_moves')
      .select('id, move_date, move_type, product_id, item_name_raw, quantity, unit_cost, total_cost, purpose, staff_name, employee_id')
      .order('id')
      .range(from, to),
  )
  if ('error' in movesRes) {
    if (/erp_sample_moves/.test(movesRes.error)) {
      return NextResponse.json({ migration800: false, error: MIGRATION_MSG }, { status: 200 })
    }
    return NextResponse.json({ error: movesRes.error }, { status: 500 })
  }
  const moves = movesRes.data

  // 재고 대상 품목 마스터
  const productsRes = await fetchAllRows<{ id: string; item_name: string; purchase_price: number }>((from, to) =>
    admin
      .from('erp_products')
      .select('id, item_name, purchase_price')
      .eq('is_sample_stock', true)
      .order('id')
      .range(from, to),
  )
  if ('error' in productsRes) return NextResponse.json({ error: productsRes.error }, { status: 500 })
  const productById = new Map(productsRes.data.map((p) => [p.id, p]))

  // 실사: 품목별 최근 1건
  const takesRes = await fetchAllRows<TakeRow>((from, to) =>
    admin
      .from('erp_sample_stocktakes')
      .select('take_date, product_id, counted_qty, computed_qty')
      .order('id')
      .range(from, to),
  )
  if ('error' in takesRes) return NextResponse.json({ error: takesRes.error }, { status: 500 })
  const latestTake = new Map<string, TakeRow>()
  for (const t of takesRes.data) {
    const cur = latestTake.get(t.product_id)
    if (!cur || t.take_date > cur.take_date) latestTake.set(t.product_id, t)
  }

  // 품목별 집계: product_id 연결 행은 마스터 기준, 미연결 행은 원본 품명 그룹
  interface StockAgg {
    key: string
    productId: string | null
    name: string
    unlinked: boolean
    purchasePrice: number
    inQty: number
    outQty: number
    adjQty: number
    lastOutDate: string | null
    lastCostDate: string | null
  }
  const stockMap = new Map<string, StockAgg>()
  for (const m of moves) {
    const key = m.product_id ?? `raw:${(m.item_name_raw ?? '').trim()}`
    let s = stockMap.get(key)
    if (!s) {
      const p = m.product_id ? productById.get(m.product_id) : null
      s = {
        key,
        productId: m.product_id,
        name: p?.item_name ?? m.item_name_raw ?? '(품명 없음)',
        unlinked: !m.product_id,
        purchasePrice: p?.purchase_price ?? 0,
        inQty: 0,
        outQty: 0,
        adjQty: 0,
        lastOutDate: null,
        lastCostDate: null,
      }
      stockMap.set(key, s)
    }
    if (m.move_type === 'in') s.inQty += m.quantity
    else if (m.move_type === 'out') {
      s.outQty += m.quantity
      if (!s.lastOutDate || m.move_date > s.lastOutDate) s.lastOutDate = m.move_date
    } else s.adjQty += m.quantity
    // 미연결 품목 매입가: 원장 최신 단가 스냅샷 사용
    if (s.unlinked && m.unit_cost != null && (!s.lastCostDate || m.move_date >= s.lastCostDate)) {
      s.purchasePrice = m.unit_cost
      s.lastCostDate = m.move_date
    }
  }
  // 원장에 아직 등장하지 않은 재고 대상 품목도 표시 (재고 0)
  for (const p of productsRes.data) {
    if (!stockMap.has(p.id)) {
      stockMap.set(p.id, {
        key: p.id, productId: p.id, name: p.item_name, unlinked: false,
        purchasePrice: p.purchase_price, inQty: 0, outQty: 0, adjQty: 0,
        lastOutDate: null, lastCostDate: null,
      })
    }
  }

  const stock = Array.from(stockMap.values()).map((s) => {
    const computed = s.inQty - s.outQty + s.adjQty
    const take = s.productId ? latestTake.get(s.productId) : undefined
    return {
      key: s.key,
      productId: s.productId,
      name: s.name,
      unlinked: s.unlinked,
      purchasePrice: s.purchasePrice,
      inQty: s.inQty,
      outQty: s.outQty,
      adjQty: s.adjQty,
      computedQty: computed,
      stockValue: computed * s.purchasePrice,
      lastOutDate: s.lastOutDate,
      takeDate: take?.take_date ?? null,
      countedQty: take?.counted_qty ?? null,
      // 오차 = 실사 − 실사 시점 전산재고 (실사 이후 입출고와 무관하게 실사 기록 기준)
      takeDiff: take ? take.counted_qty - take.computed_qty : null,
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  // 소진 비용: 사무실 원장 출고 행 (용도 포함)
  const costOffice = moves
    .filter((m) => m.move_type === 'out')
    .map((m) => ({
      d: m.move_date,
      staff: m.staff_name?.trim() || '미지정',
      linked: !!m.employee_id,
      purpose: m.purpose,
      cost: m.total_cost ?? (m.unit_cost != null ? m.unit_cost * m.quantity : 0),
    }))

  // 소진 비용: 요아럽 창고 출고 (기존 주문내역 샘플 행, 무수정 — 기록된 매입합계 사용)
  // supabase-js 타입 추론이 다대일 조인을 배열로 잡는 경우가 있어 런타임에서 정규화
  type OrderHead = { order_date: string; staff_name: string | null }
  interface WhRow {
    id: string
    quantity: number
    purchase_price: number
    purchase_total: number
    erp_orders: OrderHead | OrderHead[] | null
  }
  const whRes = await fetchAllRows<WhRow>((from, to) =>
    admin
      .from('erp_order_items')
      .select('id, quantity, purchase_price, purchase_total, erp_orders!inner(order_date, staff_name)')
      .eq('order_kind', '샘플')
      .eq('purchase_vendor_name', '요아럽')
      .eq('is_canceled', false)
      .order('id')
      .range(from, to) as unknown as PromiseLike<{ data: WhRow[] | null; error: { message: string } | null }>,
  )
  if ('error' in whRes) return NextResponse.json({ error: whRes.error }, { status: 500 })
  const costWarehouse = whRes.data.map((r) => {
    const head = Array.isArray(r.erp_orders) ? r.erp_orders[0] : r.erp_orders
    return {
      d: head?.order_date ?? '',
      staff: head?.staff_name?.trim() || '미지정',
      cost: r.purchase_total || r.purchase_price * r.quantity || 0,
    }
  })

  // 입력 폼용 직원 목록
  const { data: employees, error: empErr } = await admin
    .from('employees')
    .select('id, name')
    .order('name')
  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 })

  return NextResponse.json({
    migration800: true,
    stock,
    costOffice,
    costWarehouse,
    employees: employees ?? [],
  })
}
