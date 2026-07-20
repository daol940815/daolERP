import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { MATCH_RULES } from '@/lib/matching-rules'

// ── 매출 수금 후보 탐색 (매출 사이클 — 매입 지급후보의 매출판) ─────────────
// 한 매출처의 "미수 ERP 주문"과 "미배분 입금(통장 + 카드 순매출)"을 놓고 조합을 찾는다.
//   A. 1:1 정확 일치 (주문 잔액 = 입금 잔액)
//   B. 합산 수금: 입금 1건 = 주문 여러 건의 합 (몰아서 입금)
//   C. 분할 수금: 주문 1건 = 입금 여러 건의 합 (통장+카드 나눠 수금)
// 원칙: 여기서는 후보만 만든다 — 연결 확정은 사용자가 한다.
// 날짜 규칙: 주문 후 0~120일(1차 30일 우선). 선입금 관행 매출처(확정 이력 학습)는
// 주문 전 31일까지 후보에 포함한다 — 매입 선지급 관행과 동일한 구조.

export interface CollectionOrder {
  id: string
  order_no: string
  order_date: string
  net_amount: number
  remaining: number
}
export interface CollectionDeposit {
  id: string
  source_type: 'bank' | 'card'
  tx_date: string
  tx_time?: string | null
  label: string        // 통장: 입금자/적요, 카드: 카드번호·매입사
  amount: number
  remaining: number
}
export interface CollectionGroup {
  type: 'exact' | 'combined_orders' | 'split_collection'
  label: string
  orders: CollectionOrder[]
  deposits: CollectionDeposit[]
  amount: number
  links: { orderId: string; sourceType: 'bank' | 'card'; sourceId: string; amount: number; paidDate: string }[]
}

const MAX_COMBO = 8
const MAX_NODES = 30000
const FAR = MATCH_RULES.SPLIT_MAX_WINDOW_DAYS   // 주문 후 최대 탐색 일수
const NEAR = MATCH_RULES.SPLIT_NEAR_WINDOW_DAYS // 1차 탐색 창

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

// 선입금 관행 판정 — 이 매출처의 확정 수금 이력에서 "주문 전 입금" 비율
async function isPrepayCustomer(admin: SupabaseClient, orderIds: string[], orderDate: Map<string, string>): Promise<boolean> {
  let pre = 0, post = 0
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data } = await admin
      .from('erp_payment_matches')
      .select('order_id, paid_date')
      .in('order_id', orderIds.slice(i, i + 100))
    for (const m of data ?? []) {
      const od = orderDate.get(m.order_id as string)
      if (!od) continue
      if (dayDiff(m.paid_date as string, od) < 0) pre++
      else post++
    }
  }
  return pre >= MATCH_RULES.PREPAY_MIN_COUNT && pre / Math.max(1, pre + post) >= MATCH_RULES.PREPAY_MIN_RATIO
}

export async function buildCollectionCandidates(
  admin: SupabaseClient,
  vendorId: string,
): Promise<{ orders: CollectionOrder[]; deposits: CollectionDeposit[]; groups: CollectionGroup[]; prepayCustomer: boolean } | { error: string }> {

  // 이 매출처의 ERP 별칭 → 주문
  const aliasResult = await fetchAllRows<{ id: string }>((f, t) =>
    admin.from('erp_vendor_aliases').select('id').eq('alias_type', 'customer').eq('vendor_id', vendorId).range(f, t))
  if ('error' in aliasResult) return { error: aliasResult.error }
  const aliasIds = aliasResult.data.map(a => a.id)
  if (!aliasIds.length) return { orders: [], deposits: [], groups: [], prepayCustomer: false }

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

  // 배분 이력 (주문·원천 잔액 계산)
  const allocByOrder = new Map<string, number>()
  const allocBySource = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 100) {
    const { data, error } = await admin
      .from('erp_payment_matches')
      .select('order_id, source_type, source_id, amount')
      .in('order_id', orderIds.slice(i, i + 100))
    if (error) return { error: error.message }
    for (const m of data ?? []) allocByOrder.set(m.order_id as string, (allocByOrder.get(m.order_id as string) ?? 0) + (m.amount as number))
  }

  const orders: CollectionOrder[] = orderRows
    .map(o => {
      const net = (o.total_amount ?? 0) - (excluded.get(o.id) ?? 0)
      return { id: o.id, order_no: o.order_no, order_date: o.order_date, net_amount: net, remaining: net - (allocByOrder.get(o.id) ?? 0) }
    })
    .filter(o => o.remaining > 0)
    .sort((a, b) => a.order_date.localeCompare(b.order_date))

  // 이 매출처의 입금 원천 (통장 + 카드 순매출) — 원천별 기배분은 전체 매칭에서 조회
  const txResult = await fetchAllRows<{ id: string; tx_date: string; tx_time: string | null; counterparty_name: string | null; description: string | null; amount_in: number | null }>((f, t) =>
    admin.from('transactions')
      .select('id, tx_date, tx_time, counterparty_name, description, amount_in')
      .eq('vendor_id', vendorId)
      .gt('amount_in', 0)
      .is('transfer_pair_id', null)
      .range(f, t))
  if ('error' in txResult) return { error: txResult.error }

  const cardResult = await fetchAllRows<{ id: string; tx_date: string; tx_time: string | null; approval_number: string; card_number: string | null; acquirer: string | null; amount: number | null; transaction_type: string }>((f, t) =>
    admin.from('card_sales')
      .select('id, tx_date, tx_time, approval_number, card_number, acquirer, amount, transaction_type')
      .eq('vendor_id', vendorId)
      .range(f, t))
  if ('error' in cardResult) return { error: cardResult.error }

  const sourceIds: { type: 'bank' | 'card'; id: string }[] = [
    ...txResult.data.map(t => ({ type: 'bank' as const, id: t.id })),
    ...cardResult.data.map(c => ({ type: 'card' as const, id: c.id })),
  ]
  for (let i = 0; i < sourceIds.length; i += 100) {
    const chunk = sourceIds.slice(i, i + 100)
    const { data, error } = await admin
      .from('erp_payment_matches')
      .select('source_type, source_id, amount')
      .in('source_id', chunk.map(s => s.id))
    if (error) return { error: error.message }
    for (const m of data ?? []) {
      const key = `${m.source_type}:${m.source_id}`
      allocBySource.set(key, (allocBySource.get(key) ?? 0) + (m.amount as number))
    }
  }

  const deposits: CollectionDeposit[] = []
  for (const t of txResult.data) {
    const amt = t.amount_in ?? 0
    const rem = amt - (allocBySource.get(`bank:${t.id}`) ?? 0)
    if (rem > 0) deposits.push({
      id: t.id, source_type: 'bank', tx_date: t.tx_date, tx_time: t.tx_time,
      label: (t.counterparty_name || t.description || '입금').trim(), amount: amt, remaining: rem,
    })
  }
  const byApproval = new Map<string, typeof cardResult.data>()
  for (const c of cardResult.data) {
    byApproval.set(c.approval_number, [...(byApproval.get(c.approval_number) ?? []), c])
  }
  for (const rows of Array.from(byApproval.values())) {
    const appr = rows.find(r => r.transaction_type === 'approval')
    if (!appr) continue
    const net = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
    if (net <= 0) continue
    const rem = net - (allocBySource.get(`card:${appr.id}`) ?? 0)
    if (rem > 0) deposits.push({
      id: appr.id, source_type: 'card', tx_date: appr.tx_date, tx_time: appr.tx_time,
      label: `카드 ${appr.card_number ?? ''} ${appr.acquirer ?? ''}`.trim(), amount: net, remaining: rem,
    })
  }
  deposits.sort((a, b) => a.tx_date.localeCompare(b.tx_date))

  // 선입금 관행 (확정 이력 학습) → 주문 전 탐색 창 확장
  const orderDate = new Map(orderRows.map(o => [o.id, o.order_date]))
  const prepayCustomer = await isPrepayCustomer(admin, orderIds, orderDate)
  const preWindow = prepayCustomer ? MATCH_RULES.PREPAY_PRE_GRACE_DAYS : 0

  // ── 조합 탐색 (매입 지급후보와 동일한 골격) ──
  const groups: CollectionGroup[] = []
  const usedOrd = new Set<string>()
  const usedDep = new Set<string>()
  const depWindow = (o: CollectionOrder, maxDays: number) => deposits.filter(d =>
    !usedDep.has(d.id) &&
    dayDiff(d.tx_date, o.order_date) >= -preWindow &&
    dayDiff(d.tx_date, o.order_date) <= maxDays)

  // A. 1:1 정확 일치 (주문일에서 가장 가까운 입금)
  for (const o of orders) {
    const cands = depWindow(o, FAR).filter(d => d.remaining === o.remaining)
    if (!cands.length) continue
    const d = cands.sort((a, b) => Math.abs(dayDiff(a.tx_date, o.order_date)) - Math.abs(dayDiff(b.tx_date, o.order_date)))[0]
    usedOrd.add(o.id); usedDep.add(d.id)
    groups.push({
      type: 'exact', label: '1:1 정확 일치',
      orders: [o], deposits: [d], amount: o.remaining,
      links: [{ orderId: o.id, sourceType: d.source_type, sourceId: d.id, amount: o.remaining, paidDate: d.tx_date }],
    })
  }

  // C. 주문 1건 = 입금 여러 건 합 (분할 수금) — 30일 우선, 없으면 120일
  for (const o of orders) {
    if (usedOrd.has(o.id)) continue
    let picked: string[] | null = null
    for (const maxDays of [NEAR, FAR]) {
      const pool = depWindow(o, maxDays).map(d => ({ id: d.id, amount: d.remaining }))
      if (pool.length < 2) continue
      picked = findSubset(pool, o.remaining)
      if (picked) break
    }
    if (!picked) continue
    const chosen = deposits.filter(d => picked!.includes(d.id))
    usedOrd.add(o.id); chosen.forEach(d => usedDep.add(d.id))
    groups.push({
      type: 'split_collection', label: `분할 수금 (입금 ${chosen.length}건 합산)`,
      orders: [o], deposits: chosen, amount: o.remaining,
      links: chosen.map(d => ({ orderId: o.id, sourceType: d.source_type, sourceId: d.id, amount: d.remaining, paidDate: d.tx_date })),
    })
  }

  // B. 입금 1건 = 주문 여러 건 합 (합산 수금)
  for (const d of deposits) {
    if (usedDep.has(d.id)) continue
    const pool = orders
      .filter(o => !usedOrd.has(o.id) && dayDiff(d.tx_date, o.order_date) >= -preWindow && dayDiff(d.tx_date, o.order_date) <= FAR)
      .map(o => ({ id: o.id, amount: o.remaining }))
    if (pool.length < 2) continue
    const picked = findSubset(pool, d.remaining)
    if (!picked) continue
    const chosen = orders.filter(o => picked.includes(o.id))
    usedDep.add(d.id); chosen.forEach(o => usedOrd.add(o.id))
    groups.push({
      type: 'combined_orders', label: `합산 수금 (주문 ${chosen.length}건)`,
      orders: chosen, deposits: [d], amount: d.remaining,
      links: chosen.map(o => ({ orderId: o.id, sourceType: d.source_type, sourceId: d.id, amount: o.remaining, paidDate: d.tx_date })),
    })
  }

  return { orders, deposits, groups, prepayCustomer }
}
