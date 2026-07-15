import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// 입금 ↔ ERP 주문 건 단위 매칭 (마이그레이션 021: erp_payment_matches)
// 은행 입금과 카드결제(거래처 매칭된 card_sales) 대상. 현금영수증은 스키마만 지원.

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
  source_type: 'bank' | 'card'
  tx_date: string
  tx_time?: string | null
  counterparty_name: string | null
  description: string | null
  vendor_id: string
  vendor_name: string
  amount: number      // 입금액 (카드는 승인-취소 상쇄한 순매출액)
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

  const matchRowsResult = await fetchAllRows<MatchRow>((from, to) =>
    admin.from('erp_payment_matches').select('*').range(from, to),
  )
  if ('error' in matchRowsResult) {
    return { error: matchRowsResult.error, missingTable: isMissingMatchTable({ message: matchRowsResult.error }) }
  }
  const matches = matchRowsResult.data

  const allocByOrder = new Map<string, number>()
  const allocBySource = new Map<string, number>()
  for (const m of matches) {
    allocByOrder.set(m.order_id, (allocByOrder.get(m.order_id) ?? 0) + m.amount)
    if (m.source_type === 'bank' || m.source_type === 'card') {
      const key = `${m.source_type}:${m.source_id}`
      allocBySource.set(key, (allocBySource.get(key) ?? 0) + m.amount)
    }
  }

  // 매출처 별칭 → 거래처
  const aliasesResult = await fetchAllRows<{ id: string; vendor_id: string }>((from, to) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, vendor_id')
      .eq('alias_type', 'customer')
      .not('vendor_id', 'is', null)
      .range(from, to),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasToVendor = new Map(aliasesResult.data.map(a => [a.id, a.vendor_id]))

  const vendorRowsResult = await fetchAllRows<{ id: string; name: string }>((from, to) =>
    admin.from('vendors').select('id, name').range(from, to),
  )
  if ('error' in vendorRowsResult) return { error: vendorRowsResult.error }
  const vendorName = new Map(vendorRowsResult.data.map(v => [v.id, v.name]))

  // 주문 (순매출 = total - 취소/VIP/선결제 품목)
  const orderRowsResult = await fetchAllRows<{
    id: string
    order_no: string
    order_date: string
    bank_name: string | null
    branch_name: string | null
    customer_alias_id: string
    total_amount: number | null
    collect_status: string
  }>((rFrom, rTo) => {
    let oq = admin
      .from('erp_orders')
      .select('id, order_no, order_date, bank_name, branch_name, customer_alias_id, total_amount, collect_status')
      .not('customer_alias_id', 'is', null)
    if (from) oq = oq.gte('order_date', from)
    if (to)   oq = oq.lte('order_date', to)
    return oq.range(rFrom, rTo)
  })
  if ('error' in orderRowsResult) return { error: orderRowsResult.error }

  const matched = orderRowsResult.data.filter(o => aliasToVendor.has(o.customer_alias_id))
  const orderIds = matched.map(o => o.id)
  const excludedByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const idChunk = orderIds.slice(i, i + 500)
    const itemsResult = await fetchAllRows<{ order_id: string; line_total: number | null }>((rFrom, rTo) =>
      admin
        .from('erp_order_items')
        .select('order_id, line_total')
        .in('order_id', idChunk)
        .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
        .range(rFrom, rTo),
    )
    if ('error' in itemsResult) return { error: itemsResult.error }
    for (const it of itemsResult.data) {
      const cur = excludedByOrder.get(it.order_id) ?? 0
      excludedByOrder.set(it.order_id, cur + ((it.line_total as number) || 0))
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
  const txRowsResult = await fetchAllRows<{
    id: string
    tx_date: string
    counterparty_name: string | null
    description: string | null
    vendor_id: string
    amount_in: number | null
  }>((rFrom, rTo) => {
    let tq = admin
      .from('transactions')
      .select('id, tx_date, tx_time, counterparty_name, description, vendor_id, amount_in')
      .not('vendor_id', 'is', null)
      .gt('amount_in', 0)
      .order('tx_date', { ascending: false })
    if (from) tq = tq.gte('tx_date', from)
    if (to)   tq = tq.lte('tx_date', to)
    return tq.range(rFrom, rTo)
  })
  if ('error' in txRowsResult) return { error: txRowsResult.error }

  const deposits: DepositState[] = txRowsResult.data.map(t => {
    const amount = (t.amount_in as number) || 0
    const alloc = allocBySource.get(`bank:${t.id}`) ?? 0
    return {
      id: t.id as string,
      source_type: 'bank',
      tx_date: t.tx_date as string,
      tx_time: (t as { tx_time?: string | null }).tx_time ?? null,
      counterparty_name: t.counterparty_name as string | null,
      description: t.description as string | null,
      vendor_id: t.vendor_id as string,
      vendor_name: vendorName.get(t.vendor_id as string) ?? '(삭제된 거래처)',
      amount,
      allocated: alloc,
      remaining: amount - alloc,
    }
  })

  // 카드결제 매출 (거래처 매칭된 건만, 승인/취소 건을 승인번호 기준으로 상쇄해 순매출액 계산)
  const cardRowsResult = await fetchAllRows<{
    id: string
    tx_date: string
    approval_number: string
    card_number: string | null
    acquirer: string | null
    amount: number | null
    transaction_type: 'approval' | 'cancel'
    vendor_id: string
    tx_time?: string | null
  }>((rFrom, rTo) => {
    let cq = admin
      .from('card_sales')
      .select('id, tx_date, tx_time, approval_number, card_number, acquirer, amount, transaction_type, vendor_id')
      .not('vendor_id', 'is', null)
      .order('tx_date', { ascending: false })
    if (from) cq = cq.gte('tx_date', from)
    if (to)   cq = cq.lte('tx_date', to)
    return cq.range(rFrom, rTo)
  })
  if ('error' in cardRowsResult) return { error: cardRowsResult.error }
  const cardRows = cardRowsResult.data

  interface CardSaleRow {
    id: string
    tx_date: string
    tx_time?: string | null
    approval_number: string
    card_number: string | null
    acquirer: string | null
    amount: number
    transaction_type: 'approval' | 'cancel'
    vendor_id: string
  }

  const byApproval = new Map<string, CardSaleRow[]>()
  for (const r of (cardRows ?? []) as CardSaleRow[]) {
    const list = byApproval.get(r.approval_number) ?? []
    list.push(r)
    byApproval.set(r.approval_number, list)
  }

  const cardDeposits: DepositState[] = []
  for (const rows of Array.from(byApproval.values())) {
    const approvalRow = rows.find(r => r.transaction_type === 'approval')
    if (!approvalRow) continue
    const net = rows.reduce((s, r) => s + (r.amount || 0), 0)
    if (net <= 0) continue
    const vendorId = approvalRow.vendor_id
    const alloc = allocBySource.get(`card:${approvalRow.id}`) ?? 0
    cardDeposits.push({
      id: approvalRow.id,
      source_type: 'card',
      tx_date: approvalRow.tx_date,
      tx_time: approvalRow.tx_time ?? null,
      counterparty_name: approvalRow.card_number,
      description: approvalRow.acquirer,
      vendor_id: vendorId,
      vendor_name: vendorName.get(vendorId) ?? '(삭제된 거래처)',
      amount: net,
      allocated: alloc,
      remaining: net - alloc,
    })
  }

  return { deposits: [...deposits, ...cardDeposits], orders, matches }
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
