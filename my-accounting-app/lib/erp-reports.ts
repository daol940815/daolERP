import type { SupabaseClient } from '@supabase/supabase-js'
import type { ErpReceivableRow, ErpPayableRow, ErpPaymentTerm, ErpAgingRow, AgingBuckets } from '@/types/erp'
import { isMissingMatchTable } from '@/lib/erp-matching'

// ── 매출처(은행·지점)별 미수금 현황 집계 ──────────────
// 취소/VIP/선결제 품목은 순매출에서 제외, 미수금은 ERP 주문 단위 값 사용
// staff(다올직원) 지정 시 해당 직원이 담당자로 기재된 주문만 집계
export async function buildReceivableRows(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
  staff?: string | null,
): Promise<{ rows: ErpReceivableRow[]; staffNames: string[] } | { error: string }> {
  let oq = admin
    .from('erp_orders')
    .select('id, customer_alias_id, bank_name, branch_name, total_amount, outstanding_amount, collect_status, staff_name')
    .limit(50000)
  if (from) oq = oq.gte('order_date', from)
  if (to)   oq = oq.lte('order_date', to)

  const { data: allOrders, error: oe } = await oq
  if (oe) return { error: oe.message }

  // 기간 내 전체 담당직원 목록 (필터 드롭다운용)
  const staffSet = new Set<string>()
  for (const o of allOrders ?? []) {
    const s = (o.staff_name as string | null)?.trim()
    if (s) staffSet.add(s)
  }
  const staffNames = Array.from(staffSet).sort((a, b) => a.localeCompare(b, 'ko'))

  const orders = staff
    ? (allOrders ?? []).filter(o => ((o.staff_name as string | null)?.trim() ?? '') === staff)
    : (allOrders ?? [])

  const orderIds = orders.map(o => o.id as string)

  // 주문별 제외 금액(취소/VIP/선결제 품목 합계)
  const excludedByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data: items, error: ie } = await admin
      .from('erp_order_items')
      .select('order_id, line_total, is_canceled, is_vip, is_prepayment')
      .in('order_id', orderIds.slice(i, i + 500))
      .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
    if (ie) return { error: ie.message }
    for (const it of items ?? []) {
      const cur = excludedByOrder.get(it.order_id as string) ?? 0
      excludedByOrder.set(it.order_id as string, cur + ((it.line_total as number) || 0))
    }
  }

  // 주문별 매칭된 수금액 합계 (은행/카드 등 — 수금 매칭 결과를 미수금에서 차감)
  const matchedByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data: matches, error: me } = await admin
      .from('erp_payment_matches')
      .select('order_id, amount')
      .in('order_id', orderIds.slice(i, i + 500))
    if (me) {
      if (!isMissingMatchTable(me)) return { error: me.message }
      break
    }
    for (const m of matches ?? []) {
      const cur = matchedByOrder.get(m.order_id as string) ?? 0
      matchedByOrder.set(m.order_id as string, cur + ((m.amount as number) || 0))
    }
  }

  // 별칭 정보 + 거래처명
  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, erp_name, vendor_id, vendors(name)')
    .eq('alias_type', 'customer')
  if (ae) return { error: ae.message }
  const aliasInfo = new Map((aliases ?? []).map(a => [a.id as string, a]))

  // 선결제 잔액 (매출처)
  const { data: prepays, error: pe } = await admin
    .from('erp_prepayments')
    .select('alias_id, entry_type, amount')
    .eq('direction', 'customer')
  if (pe) return { error: pe.message }
  const prepayBalance = new Map<string, number>()
  for (const e of prepays ?? []) {
    const cur = prepayBalance.get(e.alias_id as string) ?? 0
    prepayBalance.set(e.alias_id as string, cur + (e.entry_type === 'deposit' ? e.amount : -e.amount))
  }

  const groups = new Map<string, ErpReceivableRow>()
  const staffByGroup = new Map<string, Set<string>>()
  for (const o of orders) {
    const key = (o.customer_alias_id as string | null) ?? '__none__'
    let g = groups.get(key)
    if (!g) {
      const alias = key === '__none__' ? null : aliasInfo.get(key)
      g = {
        alias_id: key === '__none__' ? null : key,
        erp_name: (alias?.erp_name as string | undefined)
          ?? [o.bank_name, o.branch_name].filter(Boolean).join(' ')
          ?? '매출처 미지정',
        vendor_id: (alias?.vendor_id as string | null) ?? null,
        vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
        order_count: 0,
        total_amount: 0,
        excluded_amount: 0,
        outstanding_amount: 0,
        outstanding_count: 0,
        prepay_balance: prepayBalance.get(key) ?? 0,
        staff_names: [],
      }
      groups.set(key, g)
      staffByGroup.set(key, new Set())
    }
    const staffName = (o.staff_name as string | null)?.trim()
    if (staffName) staffByGroup.get(key)!.add(staffName)
    const excluded = excludedByOrder.get(o.id as string) ?? 0
    g.order_count += 1
    g.total_amount += ((o.total_amount as number) || 0) - excluded
    g.excluded_amount += excluded
    if (o.collect_status !== 'collected') {
      const matched = matchedByOrder.get(o.id as string) ?? 0
      const remaining = Math.max(((o.outstanding_amount as number) || 0) - matched, 0)
      g.outstanding_amount += remaining
      if (remaining > 0) g.outstanding_count += 1
    }
  }
  for (const [key, g] of Array.from(groups.entries())) {
    g.staff_names = Array.from(staffByGroup.get(key) ?? []).sort((a, b) => a.localeCompare(b, 'ko'))
  }

  const rows = Array.from(groups.values())
  rows.sort((a, b) => b.outstanding_amount - a.outstanding_amount || b.total_amount - a.total_amount)
  return { rows, staffNames }
}

// ── 매입처 × 정산월별 미결제 현황 집계 ─────────────────
// 취소/VIP/선결제 품목 제외, 정산월(settlement_month) 기준 그룹핑
export async function buildPayableRows(
  admin: SupabaseClient,
  monthFrom: string | null,  // 'YYYY-MM'
  monthTo: string | null,
): Promise<{ rows: ErpPayableRow[] } | { error: string }> {
  let iq = admin
    .from('erp_order_items')
    .select('purchase_alias_id, purchase_vendor_name, purchase_total, settlement_month')
    .eq('is_canceled', false)
    .eq('is_vip', false)
    .eq('is_prepayment', false)
    .not('purchase_alias_id', 'is', null)
    .limit(100000)
  if (monthFrom) iq = iq.gte('settlement_month', monthFrom)
  if (monthTo)   iq = iq.lte('settlement_month', monthTo)

  const { data: items, error: ie } = await iq
  if (ie) return { error: ie.message }

  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, erp_name, vendor_id, payment_term, vendors(name)')
    .eq('alias_type', 'purchase')
  if (ae) return { error: ae.message }
  const aliasInfo = new Map((aliases ?? []).map(a => [a.id as string, a]))

  const { data: settlements, error: se } = await admin
    .from('erp_purchase_settlements')
    .select('id, purchase_alias_id, settlement_month, status, paid_date, paid_amount, memo')
  if (se) return { error: se.message }
  const settleMap = new Map(
    (settlements ?? []).map(s => [`${s.purchase_alias_id}|${s.settlement_month}`, s]))

  const { data: prepays, error: pe } = await admin
    .from('erp_prepayments')
    .select('alias_id, entry_type, amount')
    .eq('direction', 'purchase')
  if (pe) return { error: pe.message }
  const prepayBalance = new Map<string, number>()
  for (const e of prepays ?? []) {
    const cur = prepayBalance.get(e.alias_id as string) ?? 0
    prepayBalance.set(e.alias_id as string, cur + (e.entry_type === 'deposit' ? e.amount : -e.amount))
  }

  const groups = new Map<string, ErpPayableRow>()
  for (const it of items ?? []) {
    const aliasId = it.purchase_alias_id as string
    const month   = (it.settlement_month as string | null) ?? '미지정'
    const key     = `${aliasId}|${month}`
    let g = groups.get(key)
    if (!g) {
      const alias  = aliasInfo.get(aliasId)
      const settle = settleMap.get(key)
      g = {
        alias_id: aliasId,
        erp_name: (alias?.erp_name as string | undefined) ?? (it.purchase_vendor_name as string | null) ?? '매입처 미지정',
        vendor_id: (alias?.vendor_id as string | null) ?? null,
        vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
        payment_term: ((alias?.payment_term as ErpPaymentTerm | undefined) ?? 'monthly'),
        settlement_month: month,
        item_count: 0,
        purchase_total: 0,
        settlement_id: (settle?.id as string | undefined) ?? null,
        status: ((settle?.status as 'unpaid' | 'paid' | undefined) ?? 'unpaid'),
        paid_date: (settle?.paid_date as string | null) ?? null,
        paid_amount: (settle?.paid_amount as number | null) ?? null,
        settlement_memo: (settle?.memo as string | null) ?? null,
        prepay_balance: prepayBalance.get(aliasId) ?? 0,
      }
      groups.set(key, g)
    }
    g.item_count += 1
    g.purchase_total += (it.purchase_total as number) || 0
  }

  const rows = Array.from(groups.values())
  rows.sort((a, b) =>
    b.settlement_month.localeCompare(a.settlement_month) ||
    (a.status === 'unpaid' ? -1 : 1) - (b.status === 'unpaid' ? -1 : 1) ||
    b.purchase_total - a.purchase_total)
  return { rows }
}

// ── Aging 분석 공통 유틸 ────────────────────────────────
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${to}T00:00:00`).getTime()
  return Math.floor((b - a) / 86400000)
}

function agingBucketKey(days: number): keyof AgingBuckets {
  if (days <= 30) return 'bucket_30'
  if (days <= 60) return 'bucket_60'
  if (days <= 90) return 'bucket_90'
  return 'bucket_over'
}

function emptyBuckets(): AgingBuckets {
  return { bucket_30: 0, bucket_60: 0, bucket_90: 0, bucket_over: 0, total: 0 }
}

function sumAgingBuckets(rows: AgingBuckets[]): AgingBuckets {
  const total = emptyBuckets()
  for (const r of rows) {
    total.bucket_30   += r.bucket_30
    total.bucket_60   += r.bucket_60
    total.bucket_90   += r.bucket_90
    total.bucket_over += r.bucket_over
    total.total       += r.total
  }
  return total
}

function lastDayOfMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── 미수금 Aging 분석: 매출처별 미수금을 발생일(주문일) 기준 구간별로 집계 ──
export async function buildReceivableAgingRows(
  admin: SupabaseClient,
  asOfDate?: string | null,
): Promise<{ rows: ErpAgingRow[]; total: AgingBuckets; as_of: string } | { error: string }> {
  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10)

  const { data: orders, error: oe } = await admin
    .from('erp_orders')
    .select('id, customer_alias_id, bank_name, branch_name, order_date, outstanding_amount, collect_status')
    .neq('collect_status', 'collected')
    .gt('outstanding_amount', 0)
    .lte('order_date', asOf)
    .limit(50000)
  if (oe) return { error: oe.message }

  const orderIds = (orders ?? []).map(o => o.id as string)

  // 주문별 매칭된 수금액 합계 (미수금에서 차감)
  const matchedByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data: matches, error: me } = await admin
      .from('erp_payment_matches')
      .select('order_id, amount')
      .in('order_id', orderIds.slice(i, i + 500))
    if (me) {
      if (!isMissingMatchTable(me)) return { error: me.message }
      break
    }
    for (const m of matches ?? []) {
      const cur = matchedByOrder.get(m.order_id as string) ?? 0
      matchedByOrder.set(m.order_id as string, cur + ((m.amount as number) || 0))
    }
  }

  const { data: aliases, error: ae } = await admin
    .from('erp_vendor_aliases')
    .select('id, erp_name, vendor_id, vendors(name)')
    .eq('alias_type', 'customer')
  if (ae) return { error: ae.message }
  const aliasInfo = new Map((aliases ?? []).map(a => [a.id as string, a]))

  const groups = new Map<string, ErpAgingRow>()
  for (const o of orders ?? []) {
    const matched = matchedByOrder.get(o.id as string) ?? 0
    const remaining = Math.max(((o.outstanding_amount as number) || 0) - matched, 0)
    if (remaining <= 0) continue

    const key = (o.customer_alias_id as string | null) ?? '__none__'
    let g = groups.get(key)
    if (!g) {
      const alias = key === '__none__' ? null : aliasInfo.get(key)
      g = {
        alias_id: key === '__none__' ? null : key,
        erp_name: (alias?.erp_name as string | undefined)
          ?? [o.bank_name, o.branch_name].filter(Boolean).join(' ')
          ?? '매출처 미지정',
        vendor_id: (alias?.vendor_id as string | null) ?? null,
        vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
        ...emptyBuckets(),
      }
      groups.set(key, g)
    }
    const days = Math.max(daysBetween(o.order_date as string, asOf), 0)
    const bucket = agingBucketKey(days)
    g[bucket] += remaining
    g.total += remaining
  }

  const rows = Array.from(groups.values())
  rows.sort((a, b) => b.total - a.total)
  return { rows, total: sumAgingBuckets(rows), as_of: asOf }
}

// ── 미지급금 Aging 분석: 매입처별 미결제 정산을 정산월 말일 기준 구간별로 집계 ──
export async function buildPayableAgingRows(
  admin: SupabaseClient,
  asOfDate?: string | null,
): Promise<{ rows: ErpAgingRow[]; total: AgingBuckets; as_of: string } | { error: string }> {
  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10)
  const asOfMonth = asOf.slice(0, 7)

  const result = await buildPayableRows(admin, null, asOfMonth)
  if ('error' in result) return result

  const groups = new Map<string, ErpAgingRow>()
  for (const r of result.rows) {
    if (r.status !== 'unpaid') continue
    const amount = r.purchase_total - (r.paid_amount ?? 0)
    if (amount <= 0) continue

    let g = groups.get(r.alias_id)
    if (!g) {
      g = {
        alias_id: r.alias_id,
        erp_name: r.erp_name,
        vendor_id: r.vendor_id,
        vendor_name: r.vendor_name,
        ...emptyBuckets(),
      }
      groups.set(r.alias_id, g)
    }
    const days = r.settlement_month === '미지정'
      ? Infinity
      : Math.max(daysBetween(lastDayOfMonth(r.settlement_month), asOf), 0)
    const bucket = agingBucketKey(days)
    g[bucket] += amount
    g.total += amount
  }

  const rows = Array.from(groups.values())
  rows.sort((a, b) => b.total - a.total)
  return { rows, total: sumAgingBuckets(rows), as_of: asOf }
}
