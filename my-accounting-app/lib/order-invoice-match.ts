import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { MATCH_RULES } from '@/lib/matching-rules'

// ── 주문 ↔ 매출 계산서 연결 후보 (매출 사이클 3단 대사의 가운데 변) ──────────
// 한 매출처의 "계산서 미연결 주문"과 "미배분 매출 계산서"를 놓고 조합을 찾는다.
//   A. 1:1 정확 일치 (주문 순매출 = 계산서 합계)
//   B. 합산 발행: 계산서 1장 = 주문 여러 건의 합 (몰아서 발행)
//   C. 분할 발행: 주문 1건 = 계산서 여러 장의 합 (나눠서 발행)
// 원칙: 후보만 만든다 — 연결 확정은 사용자가 한다.
// 날짜: 주문 후 발행이 원칙 — 발행일이 주문일 -7일(유예) ~ +120일 창 (30일 우선).
// 취소쌍(원+취소 합계 0, 90일 이내) 계산서는 발행 자체가 무효라 후보에서 제외한다.

export interface LinkOrder {
  id: string
  order_no: string
  order_date: string
  net_amount: number
  remaining: number   // 순매출 - 기연결 계산서 금액
}
export interface LinkInvoice {
  id: string
  issue_date: string
  total_amount: number
  item_name: string | null
  remaining: number   // 합계 - 기배분 금액
}
export interface LinkGroup {
  type: 'exact' | 'combined_orders' | 'split_invoices'
  label: string
  orders: LinkOrder[]
  invoices: LinkInvoice[]
  amount: number
  links: { orderId: string; taxInvoiceId: string; amount: number; issueDate: string }[]
}

const MAX_COMBO = 8
const MAX_NODES = 30000
const FAR = MATCH_RULES.SPLIT_MAX_WINDOW_DAYS   // 주문 후 최대 탐색 일수 (120)
const NEAR = MATCH_RULES.SPLIT_NEAR_WINDOW_DAYS // 1차 탐색 창 (30)
const PRE_GRACE = MATCH_RULES.MANUAL_PRE_GRACE_DAYS // 발행이 주문보다 이른 유예 (7)
const CANCEL_PAIR_DAYS = 90

export const isMissingOrderInvoiceTable = (msg: string | null | undefined) =>
  !!msg && (/42P01/.test(msg) || /erp_order_invoices/.test(msg))

const dayDiff = (a: string, b: string) =>
  (new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime()) / 86_400_000

function findSubset(items: { id: string; amount: number }[], target: number): string[] | null {
  const sorted = [...items].sort((a, b) => b.amount - a.amount)
  const suffix: number[] = new Array(sorted.length + 1).fill(0)
  for (let i = sorted.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + sorted[i].amount
  let nodes = 0
  const pick: string[] = []
  const dfs = (idx: number, remain: number, depth: number): boolean => {
    if (remain === 0) return depth >= 2
    if (idx >= sorted.length || depth >= MAX_COMBO) return false
    if (remain < 0 || suffix[idx] < remain) return false
    if (++nodes > MAX_NODES) return false
    pick.push(sorted[idx].id)
    if (dfs(idx + 1, remain - sorted[idx].amount, depth + 1)) return true
    pick.pop()
    return dfs(idx + 1, remain, depth)
  }
  return dfs(0, target, 0) ? [...pick] : null
}

// 취소쌍 제외 — 같은 매출처 계산서 안에서 +A와 -A(90일 이내)를 짝지어 둘 다 제외
function excludeCancelPairs<T extends { id: string; issue_date: string; total_amount: number }>(rows: T[]): T[] {
  const excluded = new Set<string>()
  const negs = rows.filter(r => r.total_amount < 0).sort((a, b) => a.issue_date.localeCompare(b.issue_date))
  for (const neg of negs) {
    const cands = rows.filter(p =>
      !excluded.has(p.id) && p.total_amount === -neg.total_amount && p.total_amount > 0 &&
      Math.abs(dayDiff(p.issue_date, neg.issue_date)) <= CANCEL_PAIR_DAYS)
    if (!cands.length) continue
    const pos = cands.sort((a, b) =>
      Math.abs(dayDiff(a.issue_date, neg.issue_date)) - Math.abs(dayDiff(b.issue_date, neg.issue_date)))[0]
    excluded.add(pos.id)
    excluded.add(neg.id)
  }
  return rows.filter(r => r.total_amount > 0 && !excluded.has(r.id))
}

export async function buildInvoiceLinkCandidates(
  admin: SupabaseClient,
  vendorId: string,
): Promise<{ orders: LinkOrder[]; invoices: LinkInvoice[]; groups: LinkGroup[] } | { error: string; missingTable?: boolean }> {

  // 이 매출처의 ERP 별칭 → 주문
  const aliasResult = await fetchAllRows<{ id: string }>((f, t) =>
    admin.from('erp_vendor_aliases').select('id').eq('alias_type', 'customer').eq('vendor_id', vendorId).range(f, t))
  if ('error' in aliasResult) return { error: aliasResult.error }
  const aliasIds = aliasResult.data.map(a => a.id)

  const orderRows: { id: string; order_no: string; order_date: string; total_amount: number | null }[] = []
  for (let i = 0; i < aliasIds.length; i += 50) {
    const r = await fetchAllRows<typeof orderRows[number]>((f, t) =>
      admin.from('erp_orders')
        .select('id, order_no, order_date, total_amount')
        .in('customer_alias_id', aliasIds.slice(i, i + 50))
        .range(f, t))
    if ('error' in r) return { error: r.error }
    orderRows.push(...r.data)
  }

  // 순매출 = 총액 - 취소/VIP/선결제 품목
  const orderIds = orderRows.map(o => o.id)
  const excluded = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 100) {
    const r = await fetchAllRows<{ order_id: string; line_total: number | null }>((f, t) =>
      admin.from('erp_order_items')
        .select('order_id, line_total')
        .in('order_id', orderIds.slice(i, i + 100))
        .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
        .range(f, t))
    if ('error' in r) return { error: r.error }
    for (const it of r.data) excluded.set(it.order_id, (excluded.get(it.order_id) ?? 0) + (it.line_total ?? 0))
  }

  // 이 매출처의 매출 계산서 (양수, 취소쌍 제외)
  const invResult = await fetchAllRows<{ id: string; issue_date: string; total_amount: number; item_name: string | null }>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, total_amount, item_name')
      .eq('direction', 'sales')
      .eq('vendor_id', vendorId)
      .range(f, t))
  if ('error' in invResult) return { error: invResult.error }
  const invoiceRows = excludeCancelPairs(invResult.data.map(r => ({ ...r, total_amount: r.total_amount ?? 0 })))

  // 기존 연결(배분) — 주문·계산서 양쪽 잔액 계산
  const allocByOrder = new Map<string, number>()
  const allocByInvoice = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await admin
      .from('erp_order_invoices')
      .select('order_id, tax_invoice_id, amount')
      .in('order_id', orderIds.slice(i, i + 100))
    if (error) return { error: error.message, missingTable: isMissingOrderInvoiceTable(error.message) || error.code === '42P01' }
    for (const m of data ?? []) {
      allocByOrder.set(m.order_id as string, (allocByOrder.get(m.order_id as string) ?? 0) + (m.amount as number))
    }
  }
  const invoiceIds = invoiceRows.map(r => r.id)
  for (let i = 0; i < invoiceIds.length; i += 100) {
    const { data, error } = await admin
      .from('erp_order_invoices')
      .select('tax_invoice_id, amount')
      .in('tax_invoice_id', invoiceIds.slice(i, i + 100))
    if (error) return { error: error.message, missingTable: isMissingOrderInvoiceTable(error.message) || error.code === '42P01' }
    for (const m of data ?? []) {
      allocByInvoice.set(m.tax_invoice_id as string, (allocByInvoice.get(m.tax_invoice_id as string) ?? 0) + (m.amount as number))
    }
  }

  const orders: LinkOrder[] = orderRows
    .map(o => {
      const net = (o.total_amount ?? 0) - (excluded.get(o.id) ?? 0)
      return { id: o.id, order_no: o.order_no, order_date: o.order_date, net_amount: net, remaining: net - (allocByOrder.get(o.id) ?? 0) }
    })
    .filter(o => o.remaining > 0)
    .sort((a, b) => a.order_date.localeCompare(b.order_date))

  const invoices: LinkInvoice[] = invoiceRows
    .map(r => ({ id: r.id, issue_date: r.issue_date, total_amount: r.total_amount, item_name: r.item_name, remaining: r.total_amount - (allocByInvoice.get(r.id) ?? 0) }))
    .filter(r => r.remaining > 0)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date))

  // ── 조합 탐색 (수금후보와 동일한 골격) ──
  const groups: LinkGroup[] = []
  const usedOrd = new Set<string>()
  const usedInv = new Set<string>()
  // 발행일 - 주문일 = lag, 허용 창: -PRE_GRACE ~ maxDays
  const invWindow = (o: LinkOrder, maxDays: number) => invoices.filter(v =>
    !usedInv.has(v.id) &&
    dayDiff(v.issue_date, o.order_date) >= -PRE_GRACE &&
    dayDiff(v.issue_date, o.order_date) <= maxDays)

  // A. 1:1 정확 일치 (주문일에서 가장 가까운 계산서)
  for (const o of orders) {
    const cands = invWindow(o, FAR).filter(v => v.remaining === o.remaining)
    if (!cands.length) continue
    const v = cands.sort((a, b) => Math.abs(dayDiff(a.issue_date, o.order_date)) - Math.abs(dayDiff(b.issue_date, o.order_date)))[0]
    usedOrd.add(o.id); usedInv.add(v.id)
    groups.push({
      type: 'exact', label: '1:1 정확 일치',
      orders: [o], invoices: [v], amount: o.remaining,
      links: [{ orderId: o.id, taxInvoiceId: v.id, amount: o.remaining, issueDate: v.issue_date }],
    })
  }

  // C. 주문 1건 = 계산서 여러 장 합 (분할 발행) — 30일 우선, 없으면 120일
  for (const o of orders) {
    if (usedOrd.has(o.id)) continue
    let picked: string[] | null = null
    for (const maxDays of [NEAR, FAR]) {
      const pool = invWindow(o, maxDays).map(v => ({ id: v.id, amount: v.remaining }))
      if (pool.length < 2) continue
      picked = findSubset(pool, o.remaining)
      if (picked) break
    }
    if (!picked) continue
    const chosen = invoices.filter(v => picked!.includes(v.id))
    usedOrd.add(o.id); chosen.forEach(v => usedInv.add(v.id))
    groups.push({
      type: 'split_invoices', label: `분할 발행 (계산서 ${chosen.length}장 합산)`,
      orders: [o], invoices: chosen, amount: o.remaining,
      links: chosen.map(v => ({ orderId: o.id, taxInvoiceId: v.id, amount: v.remaining, issueDate: v.issue_date })),
    })
  }

  // B. 계산서 1장 = 주문 여러 건 합 (합산 발행)
  for (const v of invoices) {
    if (usedInv.has(v.id)) continue
    const pool = orders
      .filter(o => !usedOrd.has(o.id) &&
        dayDiff(v.issue_date, o.order_date) >= -PRE_GRACE &&
        dayDiff(v.issue_date, o.order_date) <= FAR)
      .map(o => ({ id: o.id, amount: o.remaining }))
    if (pool.length < 2) continue
    const picked = findSubset(pool, v.remaining)
    if (!picked) continue
    const chosen = orders.filter(o => picked.includes(o.id))
    usedInv.add(v.id); chosen.forEach(o => usedOrd.add(o.id))
    groups.push({
      type: 'combined_orders', label: `합산 발행 (주문 ${chosen.length}건)`,
      orders: chosen, invoices: [v], amount: v.remaining,
      links: chosen.map(o => ({ orderId: o.id, taxInvoiceId: v.id, amount: o.remaining, issueDate: v.issue_date })),
    })
  }

  return { orders, invoices, groups }
}
