import type { SupabaseClient } from '@supabase/supabase-js'

// 입금 ↔ ERP 주문 건 단위 매칭 (마이그레이션 021: erp_payment_matches)
// 현재는 은행 입금(매출 수금) 대상. 카드/현금영수증은 스키마만 지원.

export interface MatchRow {
  id: string
  order_id: string
  source_type: 'bank' | 'card' | 'cash'
  source_id: string
  amount: number
  paid_date: string
  matched_by: 'auto' | 'manual'
  memo: string | null
}

export interface DepositState {
  id: string
  tx_date: string
  counterparty_name: string | null
  description: string | null
  vendor_id: string
  vendor_name: string
  amount: number      // 입금액
  allocated: number   // 이미 배분된 금액
  remaining: number   // 미배분 잔액
}

export interface OrderState {
  id: string
  order_no: string
  order_date: string
  customer_name: string
  vendor_id: string
  collect_status: string
  net_amount: number  // 순매출 (취소/VIP/선결제 제외)
  allocated: number
  remaining: number
}

export interface MatchingState {
  deposits: DepositState[]
  orders: OrderState[]
  matches: MatchRow[]
}

export const isMissingMatchTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || /erp_payment_matches/.test(e.message ?? ''))

// 기간 내 입금·주문과 전체 매칭 기록을 로드해 잔액까지 계산한다.
// (배분 합계는 기간과 무관하게 전체 매칭 기준으로 계산해야 정확하다)
export async function loadMatchingState(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<MatchingState | { error: string; missingTable?: boolean }> {

  const { data: matchRows, error: me } = await admin
    .from('erp_payment_matches')
    .select('*')
    .limit(100000)
  if (me) return { error: me.message, missingTable: isMissingMatchTable(me) }
  const matches = (matchRows ?? []) as MatchRow[]

  const allocByOrder = new Map<string, number>()
  const allocBySource = new Map<string, number>()
  for (const m of matches) {
    allocByOrder.set(m.order_id, (allocByOrder.get(m.order_id) ?? 0) + m.amount)
    if (m.source_type === 'bank') {
      allocBySource.set(m.source_id, (allocBySource.get(m.source_id) ?? 0) + m.amount)
    }
  }

  // 매출처 별칭 → 거래처
  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, vendor_id')
    .eq('alias_type', 'customer')
    .not('vendor_id', 'is', null)
    .limit(20000)
  if (ae) return { error: ae.message }
  const aliasToVendor = new Map((aliases ?? []).map(a => [a.id as string, a.vendor_id as string]))

  const { data: vendorRows, error: ve } = await admin
    .from('vendors')
    .select('id, name')
    .limit(20000)
  if (ve) return { error: ve.message }
  const vendorName = new Map((vendorRows ?? []).map(v => [v.id as string, v.name as string]))

  // 주문 (순매출 = total - 취소/VIP/선결제 품목)
  let oq = admin
    .from('erp_orders')
    .select('id, order_no, order_date, bank_name, branch_name, customer_alias_id, total_amount, collect_status')
    .not('customer_alias_id', 'is', null)
    .limit(50000)
  if (from) oq = oq.gte('order_date', from)
  if (to)   oq = oq.lte('order_date', to)
  const { data: orderRows, error: oe } = await oq
  if (oe) return { error: oe.message }

  const matched = (orderRows ?? []).filter(o => aliasToVendor.has(o.customer_alias_id as string))
  const orderIds = matched.map(o => o.id as string)
  const excludedByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data: items, error: ie } = await admin
      .from('erp_order_items')
      .select('order_id, line_total')
      .in('order_id', orderIds.slice(i, i + 500))
      .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
    if (ie) return { error: ie.message }
    for (const it of items ?? []) {
      const cur = excludedByOrder.get(it.order_id as string) ?? 0
      excludedByOrder.set(it.order_id as string, cur + ((it.line_total as number) || 0))
    }
  }

  const orders: OrderState[] = matched.map(o => {
    const net = ((o.total_amount as number) || 0) - (excludedByOrder.get(o.id as string) ?? 0)
    const alloc = allocByOrder.get(o.id as string) ?? 0
    return {
      id: o.id as string,
      order_no: o.order_no as string,
      order_date: o.order_date as string,
      customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' '),
      vendor_id: aliasToVendor.get(o.customer_alias_id as string)!,
      collect_status: o.collect_status as string,
      net_amount: net,
      allocated: alloc,
      remaining: net - alloc,
    }
  })

  // 은행 입금 (거래처 연결 건만)
  let tq = admin
    .from('transactions')
    .select('id, tx_date, counterparty_name, description, vendor_id, amount_in')
    .not('vendor_id', 'is', null)
    .gt('amount_in', 0)
    .order('tx_date', { ascending: false })
    .limit(100000)
  if (from) tq = tq.gte('tx_date', from)
  if (to)   tq = tq.lte('tx_date', to)
  const { data: txRows, error: te } = await tq
  if (te) return { error: te.message }

  const deposits: DepositState[] = (txRows ?? []).map(t => {
    const amount = (t.amount_in as number) || 0
    const alloc = allocBySource.get(t.id as string) ?? 0
    return {
      id: t.id as string,
      tx_date: t.tx_date as string,
      counterparty_name: t.counterparty_name as string | null,
      description: t.description as string | null,
      vendor_id: t.vendor_id as string,
      vendor_name: vendorName.get(t.vendor_id as string) ?? '(삭제된 거래처)',
      amount,
      allocated: alloc,
      remaining: amount - alloc,
    }
  })

  return { deposits, orders, matches }
}

// 고신뢰 자동 매칭: 같은 거래처 + 잔액 정확 일치 + 날짜 차이 windowDays 이내 + 1:1 유일
// (선입금 거래처가 있어 입금이 주문보다 빠를 수 있으므로 날짜 차이는 절대값 기준)
export function findAutoMatches(
  state: MatchingState,
  windowDays: number,
): { deposit: DepositState; order: OrderState }[] {
  const dayDiff = (a: string, b: string) =>
    Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000

  const ordersByVendor = new Map<string, OrderState[]>()
  for (const o of state.orders) {
    if (o.remaining <= 0) continue
    const list = ordersByVendor.get(o.vendor_id) ?? []
    list.push(o)
    ordersByVendor.set(o.vendor_id, list)
  }

  // 후보 쌍: 입금 잔액 == 주문 잔액 & 날짜 근접
  const byDeposit = new Map<string, OrderState[]>()
  const byOrder = new Map<string, DepositState[]>()
  for (const d of state.deposits) {
    if (d.remaining <= 0) continue
    for (const o of ordersByVendor.get(d.vendor_id) ?? []) {
      if (o.remaining !== d.remaining) continue
      if (dayDiff(d.tx_date, o.order_date) > windowDays) continue
      byDeposit.set(d.id, [...(byDeposit.get(d.id) ?? []), o])
      byOrder.set(o.id, [...(byOrder.get(o.id) ?? []), d])
    }
  }

  // 양방향 모두 후보가 1개일 때만 확정 (모호한 건 검토대기로 남김)
  const pairs: { deposit: DepositState; order: OrderState }[] = []
  for (const d of state.deposits) {
    const cand = byDeposit.get(d.id)
    if (!cand || cand.length !== 1) continue
    const o = cand[0]
    if ((byOrder.get(o.id) ?? []).length !== 1) continue
    pairs.push({ deposit: d, order: o })
  }
  return pairs
}
