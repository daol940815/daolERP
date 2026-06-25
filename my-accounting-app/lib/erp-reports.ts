import type { SupabaseClient } from '@supabase/supabase-js'
import type { ErpReceivableRow, ErpPayableRow, ErpPaymentTerm, ErpAgingRow, AgingBuckets } from '@/types/erp'
import { isMissingMatchTable } from '@/lib/erp-matching'

const PAGE_SIZE = 1000

// Supabase 프로젝트의 PostgREST 설정(max-rows, 기본 1000)을 넘는 .limit() 요청은
// 서버가 조용히 잘라서 반환한다 — 데이터가 늘어나면 큰 .limit() 한 번으로는 전체를
// 못 읽어와 합계가 실제보다 적게 집계되는 문제가 생긴다. range()로 페이지를 나눠
// 끝까지 읽어와야 안전하다.
async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: rows }
}

type PayableItemAgg = { purchase_alias_id: string; settlement_month: string | null; item_count: number; purchase_total: number }

// 정산월×매입처 품목 집계 — DB 집계 RPC(erp_payable_item_summary) 우선,
// 마이그레이션 036 미적용 시 앱-사이드 품목 스캔으로 폴백.
async function loadPayableItemSummary(
  admin: SupabaseClient,
  monthFrom: string | null,
  monthTo: string | null,
): Promise<{ rows: PayableItemAgg[] } | { error: string }> {
  const rpc = await fetchAllRows<{ purchase_alias_id: string; settlement_month: string | null; item_count: number | string; purchase_total: number | string }>((f, t) =>
    admin.rpc('erp_payable_item_summary', { p_from: monthFrom, p_to: monthTo }).range(f, t),
  )
  if (!('error' in rpc)) {
    return {
      rows: rpc.data.map(r => ({
        purchase_alias_id: r.purchase_alias_id,
        settlement_month: r.settlement_month,
        item_count: Number(r.item_count) || 0,
        purchase_total: Number(r.purchase_total) || 0,
      })),
    }
  }
  if (!/erp_payable_item_summary/.test(rpc.error)) return { error: rpc.error }

  const itemsResult = await fetchAllRows<{ purchase_alias_id: string; settlement_month: string | null; purchase_total: number | null }>((rFrom, rTo) => {
    let iq = admin
      .from('erp_order_items')
      .select('purchase_alias_id, settlement_month, purchase_total')
      .eq('is_canceled', false)
      .eq('is_vip', false)
      .eq('is_prepayment', false)
      .not('purchase_alias_id', 'is', null)
      .range(rFrom, rTo)
    if (monthFrom) iq = iq.gte('settlement_month', monthFrom)
    if (monthTo)   iq = iq.lte('settlement_month', monthTo)
    return iq
  })
  if ('error' in itemsResult) return { error: itemsResult.error }
  const m = new Map<string, PayableItemAgg>()
  for (const it of itemsResult.data) {
    const key = `${it.purchase_alias_id}|${it.settlement_month ?? ''}`
    let a = m.get(key)
    if (!a) { a = { purchase_alias_id: it.purchase_alias_id, settlement_month: it.settlement_month, item_count: 0, purchase_total: 0 }; m.set(key, a) }
    a.item_count += 1
    a.purchase_total += it.purchase_total ?? 0
  }
  return { rows: Array.from(m.values()) }
}

// ── 매출처(은행·지점)별 미수금 현황 집계 ──────────────
// 취소/VIP/선결제 품목은 순매출에서 제외, 미수금은 ERP 주문 단위 값 사용
// staff(다올직원) 지정 시 해당 직원이 담당자로 기재된 주문만 집계
//
// 1순위: DB 집계 RPC(erp_receivable_summary/erp_receivable_staff_names).
// 폴백: 마이그레이션 037 미적용 시 앱-사이드 집계(buildReceivableFromOrders).
export async function buildReceivableRows(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
  staff?: string | null,
): Promise<{ rows: ErpReceivableRow[]; staffNames: string[] } | { error: string }> {
  const staffArg = staff && staff.trim() ? staff : null

  const sumResp = await admin.rpc('erp_receivable_summary', { p_from: from, p_to: to, p_staff: staffArg })
  if (sumResp.error) {
    const missing = sumResp.error.code === 'PGRST202' || /erp_receivable_summary/.test(sumResp.error.message ?? '')
    if (!missing) return { error: sumResp.error.message }
    return buildReceivableFromOrders(admin, from, to, staff)
  }

  const staffResp = await admin.rpc('erp_receivable_staff_names', { p_from: from, p_to: to })
  if (staffResp.error) return { error: staffResp.error.message }
  const staffNames = ((staffResp.data ?? []) as { staff_name: string }[])
    .map(r => r.staff_name)
    .sort((a, b) => a.localeCompare(b, 'ko'))

  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string | null; vendor_id: string | null; vendors: unknown }>((rFrom, rTo) =>
    admin.from('erp_vendor_aliases').select('id, erp_name, vendor_id, vendors(name)').eq('alias_type', 'customer').range(rFrom, rTo),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasInfo = new Map(aliasesResult.data.map(a => [a.id, a]))

  const prepaysResult = await fetchAllRows<{ alias_id: string; entry_type: string; amount: number }>((rFrom, rTo) =>
    admin.from('erp_prepayments').select('alias_id, entry_type, amount').eq('direction', 'customer').range(rFrom, rTo),
  )
  if ('error' in prepaysResult) return { error: prepaysResult.error }
  const prepayBalance = new Map<string, number>()
  for (const e of prepaysResult.data) {
    prepayBalance.set(e.alias_id, (prepayBalance.get(e.alias_id) ?? 0) + (e.entry_type === 'deposit' ? e.amount : -e.amount))
  }

  type SumRow = {
    alias_id: string | null; order_count: number | string; total_amount: number | string; excluded_amount: number | string
    outstanding_amount: number | string; outstanding_count: number | string; staff_names: string[] | null
  }
  const rows: ErpReceivableRow[] = ((sumResp.data ?? []) as SumRow[]).map(s => {
    const alias = s.alias_id ? aliasInfo.get(s.alias_id) : null
    return {
      alias_id: s.alias_id ?? null,
      erp_name: (alias?.erp_name as string | undefined) ?? '매출처 미지정',
      vendor_id: (alias?.vendor_id as string | null) ?? null,
      vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
      order_count: Number(s.order_count) || 0,
      total_amount: Number(s.total_amount) || 0,
      excluded_amount: Number(s.excluded_amount) || 0,
      outstanding_amount: Number(s.outstanding_amount) || 0,
      outstanding_count: Number(s.outstanding_count) || 0,
      prepay_balance: prepayBalance.get(s.alias_id ?? '') ?? 0,
      staff_names: (s.staff_names ?? []).slice().sort((a, b) => a.localeCompare(b, 'ko')),
    }
  })
  rows.sort((a, b) => b.outstanding_amount - a.outstanding_amount || b.total_amount - a.total_amount)
  return { rows, staffNames }
}

// ── 폴백: 앱-사이드 미수금 집계 (RPC 미적용 시) ──
async function buildReceivableFromOrders(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
  staff?: string | null,
): Promise<{ rows: ErpReceivableRow[]; staffNames: string[] } | { error: string }> {
  const ordersResult = await fetchAllRows((rFrom, rTo) => {
    let oq = admin
      .from('erp_orders')
      .select('id, customer_alias_id, bank_name, branch_name, total_amount, outstanding_amount, collect_status, staff_name')
      .range(rFrom, rTo)
    if (from) oq = oq.gte('order_date', from)
    if (to)   oq = oq.lte('order_date', to)
    return oq
  })
  if ('error' in ordersResult) return { error: ordersResult.error }
  const allOrders = ordersResult.data

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
  // RPC(POST body로 order_id 배열 전달)로 일괄 조회 — .in()으로 나눠 조회하면
  // 조회 기간이 길어져 주문 건수가 많을 때 URL이 비대해져 fetch가 실패할 수 있음
  const excludedByOrder = new Map<string, number>()
  if (orderIds.length > 0) {
    const { data: exclusions, error: ie } = await admin
      .rpc('erp_order_item_exclusions', { p_order_ids: orderIds })
    if (ie) return { error: ie.message }
    for (const row of exclusions ?? []) {
      excludedByOrder.set(row.order_id as string, (row.excluded_amount as number) || 0)
    }
  }

  // 주문별 매칭된 수금액 합계 (은행/카드 등 — 수금 매칭 결과를 미수금에서 차감)
  const matchedByOrder = new Map<string, number>()
  if (orderIds.length > 0) {
    const { data: matches, error: me } = await admin
      .rpc('erp_order_payment_matches', { p_order_ids: orderIds })
    if (me) {
      if (!isMissingMatchTable(me)) return { error: me.message }
    } else {
      for (const row of matches ?? []) {
        matchedByOrder.set(row.order_id as string, (row.matched_amount as number) || 0)
      }
    }
  }

  // 별칭 정보 + 거래처명
  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string | null; vendor_id: string | null; vendors: unknown }>((rFrom, rTo) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, vendors(name)')
      .eq('alias_type', 'customer')
      .range(rFrom, rTo),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasInfo = new Map(aliasesResult.data.map(a => [a.id, a]))

  // 선결제 잔액 (매출처)
  const prepaysResult = await fetchAllRows<{ alias_id: string; entry_type: string; amount: number }>((rFrom, rTo) =>
    admin
      .from('erp_prepayments')
      .select('alias_id, entry_type, amount')
      .eq('direction', 'customer')
      .range(rFrom, rTo),
  )
  if ('error' in prepaysResult) return { error: prepaysResult.error }
  const prepayBalance = new Map<string, number>()
  for (const e of prepaysResult.data) {
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
  // 정산월×매입처 품목 집계 — DB 집계 RPC 우선, 미적용 시 앱-사이드 스캔 폴백
  const summary = await loadPayableItemSummary(admin, monthFrom, monthTo)
  if ('error' in summary) return { error: summary.error }

  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string | null; vendor_id: string | null; payment_term: string | null; vendors: unknown }>((rFrom, rTo) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, payment_term, vendors(name)')
      .eq('alias_type', 'purchase')
      .range(rFrom, rTo),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasInfo = new Map(aliasesResult.data.map(a => [a.id, a]))

  const settlementsResult = await fetchAllRows<{ id: string; purchase_alias_id: string; settlement_month: string; status: string; paid_date: string | null; paid_amount: number | null; memo: string | null }>((rFrom, rTo) =>
    admin
      .from('erp_purchase_settlements')
      .select('id, purchase_alias_id, settlement_month, status, paid_date, paid_amount, memo')
      .range(rFrom, rTo),
  )
  if ('error' in settlementsResult) return { error: settlementsResult.error }
  const settleMap = new Map(
    settlementsResult.data.map(s => [`${s.purchase_alias_id}|${s.settlement_month}`, s]))

  const prepaysResult = await fetchAllRows<{ alias_id: string; entry_type: string; amount: number }>((rFrom, rTo) =>
    admin
      .from('erp_prepayments')
      .select('alias_id, entry_type, amount')
      .eq('direction', 'purchase')
      .range(rFrom, rTo),
  )
  if ('error' in prepaysResult) return { error: prepaysResult.error }
  const prepayBalance = new Map<string, number>()
  for (const e of prepaysResult.data) {
    const cur = prepayBalance.get(e.alias_id as string) ?? 0
    prepayBalance.set(e.alias_id as string, cur + (e.entry_type === 'deposit' ? e.amount : -e.amount))
  }

  const groups = new Map<string, ErpPayableRow>()
  for (const it of summary.rows) {
    const aliasId = it.purchase_alias_id
    const month   = it.settlement_month ?? '미지정'
    const key     = `${aliasId}|${month}`
    const alias  = aliasInfo.get(aliasId)
    const settle = settleMap.get(key)
    groups.set(key, {
      alias_id: aliasId,
      erp_name: (alias?.erp_name as string | undefined) ?? '매입처 미지정',
      vendor_id: (alias?.vendor_id as string | null) ?? null,
      vendor_name: (alias?.vendors as { name?: string } | null)?.name ?? null,
      payment_term: ((alias?.payment_term as ErpPaymentTerm | undefined) ?? 'monthly'),
      settlement_month: month,
      item_count: it.item_count,
      purchase_total: it.purchase_total,
      settlement_id: (settle?.id as string | undefined) ?? null,
      status: ((settle?.status as 'unpaid' | 'paid' | undefined) ?? 'unpaid'),
      paid_date: (settle?.paid_date as string | null) ?? null,
      paid_amount: (settle?.paid_amount as number | null) ?? null,
      settlement_memo: (settle?.memo as string | null) ?? null,
      prepay_balance: prepayBalance.get(aliasId) ?? 0,
    })
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

  const ordersResult = await fetchAllRows((rFrom, rTo) =>
    admin
      .from('erp_orders')
      .select('id, customer_alias_id, bank_name, branch_name, order_date, outstanding_amount, collect_status')
      .neq('collect_status', 'collected')
      .gt('outstanding_amount', 0)
      .lte('order_date', asOf)
      .range(rFrom, rTo)
  )
  if ('error' in ordersResult) return { error: ordersResult.error }
  const orders = ordersResult.data

  const orderIds = (orders ?? []).map(o => o.id as string)

  // 주문별 매칭된 수금액 합계 (미수금에서 차감)
  const matchedByOrder = new Map<string, number>()
  if (orderIds.length > 0) {
    const { data: matches, error: me } = await admin
      .rpc('erp_order_payment_matches', { p_order_ids: orderIds })
    if (me) {
      if (!isMissingMatchTable(me)) return { error: me.message }
    } else {
      for (const row of matches ?? []) {
        matchedByOrder.set(row.order_id as string, (row.matched_amount as number) || 0)
      }
    }
  }

  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string | null; vendor_id: string | null; vendors: unknown }>((rFrom, rTo) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id, vendors(name)')
      .eq('alias_type', 'customer')
      .range(rFrom, rTo),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliasInfo = new Map(aliasesResult.data.map(a => [a.id, a]))

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
