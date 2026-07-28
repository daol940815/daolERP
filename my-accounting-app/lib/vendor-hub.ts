import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { computeOrderDeliveryStatus } from '@/lib/erp-delivery-status'
import type { ErpOrderDeliveryStatus } from '@/types/erp'

// ─────────────────────────────────────────────────────────
// 매출처 허브 집계
//
// 기준(원본데이터 우선):
//  - 기간 매출  = ERP 순매출(주문 총액 - 취소/VIP/선결제 품목)
//  - 미수       = ERP 주문의 outstanding_amount 합(순매출 상한)
//  - 수금       = 순매출 - 미수  (ERP 수금 상태 기준)
//  - 수금 분해(보조)·타임라인은 회계 데이터(계산서 매칭·통장·카드)로 표시
//  - 누적 KPI: VIP 매출 = is_vip 품목 누적(취소 제외),
//              선결제 잔액 = erp_prepayments 입금-차감 누적,
//              평균 수금일 = 계산서 발행일→매칭 입금일 (금액 가중)
//  - 휴면: 최근 주문이 DORMANT_MONTHS 이전이면 '휴면 전환'
// ─────────────────────────────────────────────────────────

export const DORMANT_MONTHS = 6

// VIP는 상태가 아니라 별도 지표(VIP 누적 매출)로만 표시한다.
export type HubStatus = 'normal' | 'outstanding' | 'late' | 'over90' | 'dormant'

export interface HubListRow {
  vendor_id: string
  vendor_name: string
  biz_number: string | null
  alias_names: string[]   // ERP 표기 검색용
  alias_count: number
  card_count: number
  staff_primary: string | null
  staff_extra: number
  contact_rep: string | null
  contact_extra: number
  order_count: number
  net: number
  collected: number
  outstanding: number
  over90: number
  vip_total: number      // 누적 VIP 상품 매출
  last_order_date: string | null
  status: HubStatus
}

export interface HubListSummary {
  active_vendors: number
  net_total: number
  collected_total: number
  outstanding_total: number
  over90_total: number
  collect_ratio: number
}

interface OrderLite {
  id: string
  order_no: string | null
  order_date: string
  customer_alias_id: string | null
  total_amount: number | null
  outstanding_amount: number | null
  staff_name: string | null
}

interface FlagAgg { excluded: number; vip: number; vipCanceled: number }

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// 대형 테이블 전량 조회를 페이지 병렬로 수행 (순차 30+회 왕복 → 동시 6회씩)
// 총 건수를 먼저 세고 범위를 나눠 동시에 읽는다. 조회 사이에 행이 추가되는
// 미세한 경합은 대시보드 용도에서 허용한다(순차 페이지네이션도 동일한 한계).
async function fetchAllParallel<T>(
  countPage: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  concurrency = 6,
): Promise<{ data: T[] } | { error: string }> {
  const { count, error: cErr } = await countPage()
  if (cErr) return { error: cErr.message }
  const total = count ?? 0
  if (total === 0) return { data: [] }
  const ranges: [number, number][] = []
  for (let f = 0; f < total; f += 1000) ranges.push([f, f + 999])
  const out: T[][] = new Array(ranges.length)
  let next = 0
  let failed: string | null = null
  const worker = async () => {
    while (next < ranges.length && !failed) {
      const i = next++
      const [f, t] = ranges[i]
      const { data, error } = await page(f, t)
      if (error) { failed = error.message; return }
      out[i] = data ?? []
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker))
  if (failed) return { error: failed }
  return { data: out.flat() }
}

// 취소/VIP/선결제 품목을 주문별로 집계 (순매출 차감 + VIP 누적 계산용)
async function loadFlaggedLines(admin: SupabaseClient) {
  const r = await fetchAllRows<{ order_id: string; line_total: number | null; is_canceled: boolean; is_vip: boolean; is_prepayment: boolean }>((f, t) =>
    admin.from('erp_order_items')
      .select('order_id, line_total, is_canceled, is_vip, is_prepayment')
      .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
      .range(f, t))
  if ('error' in r) return r
  const byOrder = new Map<string, FlagAgg>()
  for (const it of r.data) {
    let a = byOrder.get(it.order_id)
    if (!a) { a = { excluded: 0, vip: 0, vipCanceled: 0 }; byOrder.set(it.order_id, a) }
    a.excluded += it.line_total ?? 0
    if (it.is_vip) {
      if (it.is_canceled) a.vipCanceled += it.line_total ?? 0
      else a.vip += it.line_total ?? 0
    }
  }
  return { data: byOrder }
}

// ── 목록 ─────────────────────────────────────────────────
export async function buildHubList(
  admin: SupabaseClient,
  fromDate: string | null,
  toDate: string | null,
): Promise<{ rows: HubListRow[]; summary: HubListSummary } | { error: string }> {
  // 보조 데이터(별칭·거래처·담당·담당자)와 주문 집계를 병렬로 진행
  const sidePromise = Promise.all([
    fetchAllRows<{ id: string; vendor_id: string; erp_name: string | null }>((f, t) =>
      admin.from('erp_vendor_aliases').select('id, vendor_id, erp_name')
        .eq('alias_type', 'customer').not('vendor_id', 'is', null).range(f, t)),
    fetchAllRows<{ id: string; name: string; card_numbers: string[] | null; biz_number: string | null }>((f, t) =>
      admin.from('vendors').select('id, name, card_numbers, biz_number').range(f, t)),
    fetchAllRows<{ vendor_id: string; is_primary: boolean; employees: unknown }>((f, t) =>
      admin.from('vendor_staff').select('vendor_id, is_primary, employees(name)')
        .is('ended_at', null).range(f, t)),
  ])

  // DB 집계 RPC 우선 (마이그레이션 101) — 미적용이면 전량 조회 폴백
  // 주의: RPC 결과도 PostgREST max-rows(1000)에 잘리므로 반드시 range로 끝까지 읽는다.
  type RpcRow = {
    vendor_id: string; order_count: number; net: number; outstanding: number
    over90: number; vip_total: number; last_order_date: string | null
  }
  let aggRows: RpcRow[] | null = null
  {
    // 1순위: JSONB 단일 응답(102) — 함수 1회 실행, 절단 없음
    const j = await admin.rpc('hub_vendor_summary_json', { p_from: fromDate, p_to: toDate })
    if (!j.error && Array.isArray(j.data)) {
      aggRows = j.data as RpcRow[]
    } else {
      // 2순위: 행 반환 RPC(101) — 페이지네이션 필수(페이지당 함수 재실행 비용 있음)
      const rpcAll = await fetchAllRows<RpcRow>((f, t) =>
        admin.rpc('hub_vendor_summary', { p_from: fromDate, p_to: toDate }).range(f, t))
      if (!('error' in rpcAll)) aggRows = rpcAll.data
    }
  }

  let fallback: { ordersResult: { data: OrderLite[] }; flagged: { data: Map<string, FlagAgg> } } | null = null
  if (!aggRows) {
    const [ordersResult, flagged] = await Promise.all([
      fetchAllParallel<OrderLite>(
        () => admin.from('erp_orders').select('id', { count: 'exact', head: true }).not('customer_alias_id', 'is', null),
        (f, t) => admin.from('erp_orders')
          .select('id, order_no, order_date, customer_alias_id, total_amount, outstanding_amount, staff_name')
          .not('customer_alias_id', 'is', null)
          .range(f, t)),
      loadFlaggedLines(admin),
    ])
    if ('error' in ordersResult) return ordersResult
    if ('error' in flagged) return flagged
    fallback = { ordersResult, flagged }
  }

  const [aliasResult, vendorsResult, staffResult] = await sidePromise
  if ('error' in aliasResult) return aliasResult
  if ('error' in vendorsResult) return vendorsResult
  if ('error' in staffResult) return staffResult
  const aliasToVendor = new Map(aliasResult.data.map(a => [a.id, a.vendor_id]))
  const aliasCount = new Map<string, number>()
  const aliasNames = new Map<string, string[]>()  // 검색용 (거래처당 최대 12개)
  for (const a of aliasResult.data) {
    aliasCount.set(a.vendor_id, (aliasCount.get(a.vendor_id) ?? 0) + 1)
    if (a.erp_name) {
      const arr = aliasNames.get(a.vendor_id) ?? []
      if (arr.length < 12) { arr.push(a.erp_name); aliasNames.set(a.vendor_id, arr) }
    }
  }
  const vInfo = new Map(vendorsResult.data.map(v => [v.id, v]))
  const staffByVendor = new Map<string, { primary: string | null; extra: number }>()
  for (const s of staffResult.data) {
    const name = (s.employees as { name?: string } | null)?.name ?? null
    let e = staffByVendor.get(s.vendor_id)
    if (!e) { e = { primary: null, extra: 0 }; staffByVendor.set(s.vendor_id, e) }
    if (s.is_primary && name) { if (e.primary) e.extra++; e.primary = name }
    else if (name) { if (e.primary) e.extra++; else { e.primary = name } }
  }

  // 거래처 담당자(현재 배정) — 대표 우선
  const contactResult = await fetchAllRows<{ vendor_id: string; is_representative: boolean; title: string | null; contacts: unknown }>((f, t) =>
    admin.from('contact_assignments').select('vendor_id, is_representative, title, contacts(name)')
      .is('ended_at', null).range(f, t))
  if ('error' in contactResult) return contactResult
  const contactByVendor = new Map<string, { rep: string | null; extra: number }>()
  for (const c of contactResult.data) {
    const name = (c.contacts as { name?: string } | null)?.name ?? null
    const label = name ? (c.title ? `${name} ${c.title}` : name) : null
    let e = contactByVendor.get(c.vendor_id)
    if (!e) { e = { rep: null, extra: 0 }; contactByVendor.set(c.vendor_id, e) }
    if (c.is_representative && label) { if (e.rep) e.extra++; e.rep = label }
    else if (label) { if (e.rep) e.extra++; else e.rep = label }
  }

  const t0 = today()
  const dormantBefore = addDays(t0, -DORMANT_MONTHS * 30)
  const over90Before = addDays(t0, -90)

  interface Acc {
    order_count: number; net: number; outstanding: number; over90: number
    vip_total: number; last: string | null
  }
  const acc = new Map<string, Acc>()
  const get = (vid: string): Acc => {
    let a = acc.get(vid)
    if (!a) { a = { order_count: 0, net: 0, outstanding: 0, over90: 0, vip_total: 0, last: null }; acc.set(vid, a) }
    return a
  }

  if (aggRows) {
    // RPC 경로: DB에서 집계 완료 (JS 폴백과 동일한 규칙 — 101_hub_vendor_summary.sql)
    for (const r of aggRows) {
      const a = get(r.vendor_id)
      a.order_count = r.order_count
      a.net = r.net
      a.outstanding = r.outstanding
      a.over90 = r.over90
      a.vip_total = r.vip_total
      a.last = r.last_order_date
    }
  } else if (fallback) {
    for (const o of fallback.ordersResult.data) {
      const vid = aliasToVendor.get(o.customer_alias_id as string)
      if (!vid) continue
      const a = get(vid)
      if (!a.last || o.order_date > a.last) a.last = o.order_date
      const flags = fallback.flagged.data.get(o.id)
      a.vip_total += flags?.vip ?? 0
      const inPeriod = (!fromDate || o.order_date >= fromDate) && (!toDate || o.order_date <= toDate)
      if (!inPeriod) continue
      const net = Math.max(0, (o.total_amount ?? 0) - (flags?.excluded ?? 0))
      const out = Math.min(Math.max(0, o.outstanding_amount ?? 0), net)
      a.order_count++
      a.net += net
      a.outstanding += out
      if (out > 0 && o.order_date < over90Before) a.over90 += out
    }
  }

  const rows: HubListRow[] = []
  for (const [vid, a] of Array.from(acc.entries())) {
    const v = vInfo.get(vid)
    const st = staffByVendor.get(vid)
    const ct = contactByVendor.get(vid)
    const collected = a.net - a.outstanding
    let status: HubStatus
    if (!a.last || a.last < dormantBefore) status = 'dormant'
    else if (a.over90 > 0) status = 'over90'
    else if (a.outstanding > 0 && a.net > 0 && collected / a.net < 0.5) status = 'late'
    else if (a.outstanding > 0) status = 'outstanding'
    else status = 'normal'
    rows.push({
      vendor_id: vid,
      vendor_name: v?.name ?? '(삭제된 거래처)',
      biz_number: v?.biz_number ?? null,
      alias_names: aliasNames.get(vid) ?? [],
      alias_count: aliasCount.get(vid) ?? 0,
      card_count: v?.card_numbers?.length ?? 0,
      staff_primary: st?.primary ?? null,
      staff_extra: st?.extra ?? 0,
      contact_rep: ct?.rep ?? null,
      contact_extra: ct?.extra ?? 0,
      order_count: a.order_count,
      net: a.net,
      collected,
      outstanding: a.outstanding,
      over90: a.over90,
      vip_total: a.vip_total,
      last_order_date: a.last,
      status,
    })
  }
  rows.sort((x, y) => y.net - x.net || y.outstanding - x.outstanding)

  const active = rows.filter(r => r.order_count > 0)
  const netTotal = active.reduce((s, r) => s + r.net, 0)
  const outTotal = active.reduce((s, r) => s + r.outstanding, 0)
  return {
    rows,
    summary: {
      active_vendors: active.length,
      net_total: netTotal,
      collected_total: netTotal - outTotal,
      outstanding_total: outTotal,
      over90_total: active.reduce((s, r) => s + r.over90, 0),
      collect_ratio: netTotal > 0 ? (netTotal - outTotal) / netTotal : 1,
    },
  }
}

// ── 상세 ─────────────────────────────────────────────────

export interface HubOrderRow {
  id: string
  order_no: string | null
  order_date: string
  item_summary: string
  net: number
  delivery: ErpOrderDeliveryStatus | null
  invoice_linked: number    // 계산서 배분액
  paid_alloc: number        // 주문 수금배분액
  outstanding: number       // ERP 미수
}

export interface HubTimelineEvent {
  kind: 'invoice' | 'bank' | 'card' | 'alloc'
  date: string
  label: string
  amount: number
  ref_id: string | null
}

export interface HubSpecialItem {
  order_no: string | null
  order_date: string | null
  item_name: string | null
  quantity: number
  line_total: number
  is_canceled: boolean
}

export interface HubPrepayEntry {
  entry_date: string
  entry_type: 'deposit' | 'deduction'
  amount: number
  memo: string | null
}

export interface HubDetail {
  vendor: { id: string; name: string; biz_number: string | null; note: string | null }
  links: { alias_count: number; card_count: number; has_opening: boolean }
  staff: {
    id: string; employee_id: string; name: string; team: string | null
    is_primary: boolean; started_at: string | null; vendor_count: number
  }[]
  staff_suggest: { name: string; order_count: number; employee_id: string | null }[]
  contacts: {
    assignment_id: string; contact_id: string; name: string; phone: string | null; email: string | null
    title: string | null; role_memo: string | null; is_representative: boolean
    started_at: string | null; ended_at: string | null
  }[]
  kpi: {
    net: number; collected: number; outstanding: number
    paid_invoice: number; paid_card: number
    avg_collect_days: number | null
    vip_total: number
    prepay_deposit: number; prepay_deduction: number; prepay_balance: number
  }
  aging: { b30: number; b60: number; b90: number; over90: number; opening: number }
  orders: HubOrderRow[]
  timeline: HubTimelineEvent[]
  invoices: { id: string; issue_date: string; total_amount: number; payment_status: string; tax_type: string | null }[]
  vip_items: HubSpecialItem[]
  prepay_items: HubSpecialItem[]
  prepay_ledger: HubPrepayEntry[]
  last_order_date: string | null
  status: HubStatus
}

// .in() URL 폭발 방지 — ID 배열을 청크로 나눠 조회.
// 청크 하나의 결과가 max-rows(1000)를 넘을 수 있으므로 청크 안에서도 range로 끝까지 읽는다.
async function fetchByIds<T>(
  ids: string[],
  chunk: number,
  page: (slice: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    let from = 0
    while (true) {
      const { data, error } = await page(slice, from, from + 999)
      if (error) return { error: error.message }
      out.push(...(data ?? []))
      if (!data || data.length < 1000) break
      from += 1000
    }
  }
  return { data: out }
}

export async function buildHubDetail(
  admin: SupabaseClient,
  vendorId: string,
  fromDate: string | null,
  toDate: string | null,
): Promise<HubDetail | { error: string }> {
  const [vendorRes, aliasRes] = await Promise.all([
    admin.from('vendors').select('id, name, biz_number, note, card_numbers').eq('id', vendorId).single(),
    admin.from('erp_vendor_aliases').select('id').eq('alias_type', 'customer').eq('vendor_id', vendorId),
  ])
  if (vendorRes.error) return { error: vendorRes.error.message }
  if (aliasRes.error) return { error: aliasRes.error.message }
  const vendor = vendorRes.data
  const aliasIds = (aliasRes.data ?? []).map(a => a.id as string)

  // 주문에 의존하지 않는 조회는 먼저 출발시켜 병렬로 진행
  const openingP = admin
    .from('vendor_opening_balances').select('amount, collected_amount').eq('vendor_id', vendorId).maybeSingle()
  const invP = fetchAllRows<{ id: string; issue_date: string; total_amount: number | null; payment_status: string; tax_type: string | null }>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, total_amount, payment_status, tax_type')
      .eq('direction', 'sales').eq('vendor_id', vendorId)
      .order('issue_date', { ascending: false })
      .range(f, t))
  const cardP = fetchAllRows<{ id: string; tx_date: string; amount: number | null; transaction_type: string | null; cancelled_at: string | null; acquirer: string | null; card_number: string | null; approval_number: string | null }>((f, t) =>
    admin.from('card_sales')
      .select('id, tx_date, amount, transaction_type, cancelled_at, acquirer, card_number, approval_number')
      .eq('vendor_id', vendorId)
      .order('tx_date', { ascending: false })
      .range(f, t))
  const prepayP = aliasIds.length
    ? fetchAllRows<{ entry_date: string; entry_type: 'deposit' | 'deduction'; amount: number | null; memo: string | null }>((f, t) =>
        admin.from('erp_prepayments')
          .select('entry_date, entry_type, amount, memo')
          .eq('direction', 'customer')
          .in('alias_id', aliasIds)
          .order('entry_date', { ascending: false })
          .range(f, t))
    : Promise.resolve({ data: [] as { entry_date: string; entry_type: 'deposit' | 'deduction'; amount: number | null; memo: string | null }[] })
  const staffP = admin
    .from('vendor_staff')
    .select('id, employee_id, is_primary, started_at, employees(name, team)')
    .eq('vendor_id', vendorId).is('ended_at', null)
  const caP = admin
    .from('contact_assignments')
    .select('id, contact_id, title, role_memo, is_representative, started_at, ended_at, contacts(name, phone, email)')
    .eq('vendor_id', vendorId)
    .order('ended_at', { ascending: true, nullsFirst: true })
    .order('is_representative', { ascending: false })

  const { data: opening } = await openingP
  const openingRemain = opening && (opening.amount as number) > 0
    ? Math.max(0, (opening.amount as number) - ((opening.collected_amount as number | null) ?? 0))
    : 0

  // 주문 (해당 매출처 전체 — 기간 필터는 메모리)
  let orders: OrderLite[] = []
  if (aliasIds.length) {
    const r = await fetchAllRows<OrderLite>((f, t) =>
      admin.from('erp_orders')
        .select('id, order_no, order_date, customer_alias_id, total_amount, outstanding_amount, staff_name')
        .in('customer_alias_id', aliasIds)
        .order('order_date', { ascending: false })
        .range(f, t))
    if ('error' in r) return r
    orders = r.data
  }
  const orderIds = orders.map(o => o.id)

  // 품목 (요약·배송·VIP·선결제 탭용)
  interface ItemRow {
    order_id: string; item_name: string | null; quantity: number | null; line_total: number | null
    is_canceled: boolean; is_vip: boolean; is_prepayment: boolean; is_shipping_exempt: boolean
    tracking_number: string | null; delivery_status: string | null
  }
  const [itemsR, invAllocR, payAllocR, invR] = await Promise.all([
    fetchByIds<ItemRow>(orderIds, 60, (slice, f, t) =>
      admin.from('erp_order_items')
        .select('order_id, item_name, quantity, line_total, is_canceled, is_vip, is_prepayment, is_shipping_exempt, tracking_number, delivery_status')
        .in('order_id', slice).range(f, t)),
    // 계산서 연결(067) — 미적용 환경 폴백 0
    fetchByIds<{ order_id: string; amount: number }>(orderIds, 60, (slice, f, t) =>
      admin.from('erp_order_invoices').select('order_id, amount').in('order_id', slice).range(f, t)),
    // 주문 수금배분
    fetchByIds<{ order_id: string; amount: number; paid_date: string | null; memo: string | null }>(orderIds, 60, (slice, f, t) =>
      admin.from('erp_payment_matches').select('order_id, amount, paid_date, memo').in('order_id', slice).range(f, t)),
    invP,
  ])
  if ('error' in itemsR) return itemsR
  const itemsByOrder = new Map<string, ItemRow[]>()
  for (const it of itemsR.data) {
    const arr = itemsByOrder.get(it.order_id) ?? []
    arr.push(it); itemsByOrder.set(it.order_id, arr)
  }

  const invAlloc = new Map<string, number>()
  if (!('error' in invAllocR)) for (const m of invAllocR.data) invAlloc.set(m.order_id, (invAlloc.get(m.order_id) ?? 0) + m.amount)

  const payAlloc = new Map<string, number>()
  const allocEvents: { order_id: string; amount: number; paid_date: string | null; memo: string | null }[] = []
  if ('error' in payAllocR) return payAllocR
  for (const m of payAllocR.data) {
    payAlloc.set(m.order_id, (payAlloc.get(m.order_id) ?? 0) + m.amount)
    allocEvents.push(m)
  }

  if ('error' in invR) return invR
  const invoiceIds = invR.data.map(i => i.id)
  const invDate = new Map(invR.data.map(i => [i.id, i.issue_date]))

  const tipR = await fetchByIds<{ tax_invoice_id: string; transaction_id: string; amount: number }>(invoiceIds, 60, (slice, f, t) =>
    admin.from('tax_invoice_payments').select('tax_invoice_id, transaction_id, amount').in('tax_invoice_id', slice).range(f, t))
  if ('error' in tipR) return tipR
  const txIds = Array.from(new Set(tipR.data.map(p => p.transaction_id)))
  const txR = await fetchByIds<{ id: string; tx_date: string; description: string | null }>(txIds, 60, (slice, f, t) =>
    admin.from('transactions').select('id, tx_date, description').in('id', slice).range(f, t))
  if ('error' in txR) return txR
  const txInfo = new Map(txR.data.map(t => [t.id, t]))

  // 카드매출 (승인 기준, 취소 제외)
  const cardR = await cardP
  if ('error' in cardR) return cardR
  const cardOk = cardR.data.filter(c => !c.cancelled_at && (c.transaction_type ?? '승인') !== '취소')

  // 선결제 원장 (erp_prepayments, 매출처 별칭 기준)
  const prepayLedger: HubPrepayEntry[] = []
  let prepayDeposit = 0, prepayDeduction = 0
  {
    const r = await prepayP
    if (!('error' in r)) {
      for (const e of r.data) {
        const amt = e.amount ?? 0
        if (e.entry_type === 'deposit') prepayDeposit += amt
        else prepayDeduction += amt
        prepayLedger.push({ entry_date: e.entry_date, entry_type: e.entry_type, amount: amt, memo: e.memo })
      }
    }
  }

  // 담당직원 패널
  const { data: staffRows, error: sErr } = await staffP
  if (sErr) return { error: sErr.message }
  const empIds = (staffRows ?? []).map(s => s.employee_id as string)
  const vendorCountByEmp = new Map<string, number>()
  if (empIds.length) {
    const r = await fetchByIds<{ employee_id: string }>(empIds, 60, (slice, f, t) =>
      admin.from('vendor_staff').select('employee_id').in('employee_id', slice).is('ended_at', null).range(f, t))
    if (!('error' in r)) for (const s of r.data) vendorCountByEmp.set(s.employee_id, (vendorCountByEmp.get(s.employee_id) ?? 0) + 1)
  }

  // ERP 담당 추천 (주문 staff_name 빈도) — 이미 배정된 이름 제외
  const staffNameCount = new Map<string, number>()
  for (const o of orders) {
    const n = (o.staff_name ?? '').trim()
    if (n) staffNameCount.set(n, (staffNameCount.get(n) ?? 0) + 1)
  }
  const assignedNames = new Set((staffRows ?? []).map(s => ((s.employees as { name?: string } | null)?.name ?? '').trim()))
  const suggestNames = Array.from(staffNameCount.entries())
    .filter(([n]) => !assignedNames.has(n))
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
  const staffSuggest: HubDetail['staff_suggest'] = []
  for (const [name, cnt] of suggestNames) {
    const { data: emp } = await admin.from('employees').select('id').eq('name', name).eq('is_active', true).maybeSingle()
    staffSuggest.push({ name, order_count: cnt, employee_id: (emp?.id as string | undefined) ?? null })
  }

  // 거래처 담당자 패널 (이력 포함)
  const { data: caRows, error: caErr } = await caP
  if (caErr) return { error: caErr.message }

  // ── 집계 ──
  const flaggedLocal = new Map<string, FlagAgg>()
  for (const [oid, items] of Array.from(itemsByOrder.entries())) {
    const a: FlagAgg = { excluded: 0, vip: 0, vipCanceled: 0 }
    for (const it of items) {
      if (it.is_canceled || it.is_vip || it.is_prepayment) a.excluded += it.line_total ?? 0
      if (it.is_vip && !it.is_canceled) a.vip += it.line_total ?? 0
    }
    flaggedLocal.set(oid, a)
  }

  const t0 = today()
  const inPeriod = (d: string) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate)
  let net = 0, outstanding = 0, over90 = 0
  const aging = { b30: 0, b60: 0, b90: 0, over90: 0, opening: openingRemain }
  const orderRows: HubOrderRow[] = []
  let vipTotal = 0
  let lastOrder: string | null = null

  for (const o of orders) {
    if (!lastOrder || o.order_date > lastOrder) lastOrder = o.order_date
    const flags = flaggedLocal.get(o.id)
    vipTotal += flags?.vip ?? 0
    const oNet = Math.max(0, (o.total_amount ?? 0) - (flags?.excluded ?? 0))
    const oOut = Math.min(Math.max(0, o.outstanding_amount ?? 0), oNet)
    if (oOut > 0) {
      const age = Math.floor((new Date(t0).getTime() - new Date(o.order_date).getTime()) / 86400000)
      if (age <= 30) aging.b30 += oOut
      else if (age <= 60) aging.b60 += oOut
      else if (age <= 90) aging.b90 += oOut
      else aging.over90 += oOut
    }
    if (!inPeriod(o.order_date)) continue
    net += oNet
    outstanding += oOut
    const age = Math.floor((new Date(t0).getTime() - new Date(o.order_date).getTime()) / 86400000)
    if (oOut > 0 && age > 90) over90 += oOut

    const items = (itemsByOrder.get(o.id) ?? []).filter(it => !it.is_canceled)
    const first = items.find(it => it.item_name)?.item_name ?? '(품목 없음)'
    const extra = Math.max(0, items.length - 1)
    orderRows.push({
      id: o.id,
      order_no: o.order_no,
      order_date: o.order_date,
      item_summary: extra > 0 ? `${first} 외 ${extra}` : first,
      net: oNet,
      delivery: computeOrderDeliveryStatus((itemsByOrder.get(o.id) ?? []) as never[]),
      invoice_linked: Math.min(invAlloc.get(o.id) ?? 0, oNet),
      paid_alloc: Math.min(payAlloc.get(o.id) ?? 0, oNet),
      outstanding: oOut,
    })
  }

  // 수금 분해(회계 데이터, 기간 내 입금일)
  let paidInvoice = 0
  let daysWeighted = 0, daysAmount = 0
  const timeline: HubTimelineEvent[] = []
  const seenTx = new Set<string>()
  for (const p of tipR.data) {
    const tx = txInfo.get(p.transaction_id)
    const d = tx?.tx_date ?? null
    const issue = invDate.get(p.tax_invoice_id)
    if (d && issue) {
      const dd = Math.round((new Date(d).getTime() - new Date(issue).getTime()) / 86400000)
      if (dd >= 0 && dd < 400) { daysWeighted += dd * p.amount; daysAmount += p.amount }
    }
    if (d && inPeriod(d)) paidInvoice += p.amount
    if (d && !seenTx.has(p.transaction_id)) {
      seenTx.add(p.transaction_id)
      timeline.push({ kind: 'bank', date: d, label: tx?.description ?? '입금 (계산서 매칭)', amount: p.amount, ref_id: p.transaction_id })
    }
  }
  let paidCard = 0
  for (const c of cardOk) {
    if (inPeriod(c.tx_date)) paidCard += c.amount ?? 0
    timeline.push({
      kind: 'card', date: c.tx_date,
      label: `카드매출 (${c.acquirer ?? '매입사 미상'}${c.card_number ? ' ' + c.card_number.slice(-4) : ''})`,
      amount: c.amount ?? 0, ref_id: c.approval_number ?? null,  // 카드매출 화면 검색 딥링크용
    })
  }
  for (const inv of invR.data) {
    timeline.push({ kind: 'invoice', date: inv.issue_date, label: `전자세금계산서 발행`, amount: inv.total_amount ?? 0, ref_id: inv.id })
  }
  for (const a of allocEvents) {
    if (!a.paid_date) continue
    timeline.push({ kind: 'alloc', date: a.paid_date, label: a.memo || '주문 수금배분', amount: a.amount, ref_id: a.order_id })
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date))

  const dormantBefore = addDays(t0, -DORMANT_MONTHS * 30)
  let status: HubStatus
  const collected = net - outstanding
  if (!lastOrder || lastOrder < dormantBefore) status = 'dormant'
  else if (over90 > 0) status = 'over90'
  else if (outstanding > 0 && net > 0 && collected / net < 0.5) status = 'late'
  else if (outstanding > 0) status = 'outstanding'
  else status = 'normal'

  const pick = (flag: 'is_vip' | 'is_prepayment'): HubSpecialItem[] => {
    const out: HubSpecialItem[] = []
    for (const o of orders) {
      for (const it of itemsByOrder.get(o.id) ?? []) {
        if (!it[flag]) continue
        out.push({
          order_no: o.order_no, order_date: o.order_date,
          item_name: it.item_name, quantity: it.quantity ?? 0,
          line_total: it.line_total ?? 0, is_canceled: it.is_canceled,
        })
      }
    }
    return out
  }

  return {
    vendor: { id: vendor.id, name: vendor.name, biz_number: vendor.biz_number, note: vendor.note },
    links: {
      alias_count: aliasIds.length,
      card_count: (vendor.card_numbers as string[] | null)?.length ?? 0,
      has_opening: !!opening,
    },
    staff: (staffRows ?? []).map(s => ({
      id: s.id as string,
      employee_id: s.employee_id as string,
      name: (s.employees as { name?: string } | null)?.name ?? '(삭제된 직원)',
      team: (s.employees as { team?: string | null } | null)?.team ?? null,
      is_primary: s.is_primary as boolean,
      started_at: s.started_at as string | null,
      vendor_count: vendorCountByEmp.get(s.employee_id as string) ?? 0,
    })).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    staff_suggest: staffSuggest,
    contacts: (caRows ?? []).map(c => ({
      assignment_id: c.id as string,
      contact_id: c.contact_id as string,
      name: (c.contacts as { name?: string } | null)?.name ?? '(삭제된 인물)',
      phone: (c.contacts as { phone?: string | null } | null)?.phone ?? null,
      email: (c.contacts as { email?: string | null } | null)?.email ?? null,
      title: c.title as string | null,
      role_memo: c.role_memo as string | null,
      is_representative: c.is_representative as boolean,
      started_at: c.started_at as string | null,
      ended_at: c.ended_at as string | null,
    })),
    kpi: {
      net, collected, outstanding,
      paid_invoice: paidInvoice, paid_card: paidCard,
      avg_collect_days: daysAmount > 0 ? Math.round(daysWeighted / daysAmount) : null,
      vip_total: vipTotal,
      prepay_deposit: prepayDeposit, prepay_deduction: prepayDeduction,
      prepay_balance: prepayDeposit - prepayDeduction,
    },
    aging,
    orders: orderRows,
    timeline: timeline.slice(0, 200),
    invoices: invR.data.map(i => ({ id: i.id, issue_date: i.issue_date, total_amount: i.total_amount ?? 0, payment_status: i.payment_status, tax_type: i.tax_type })),
    vip_items: pick('is_vip'),
    prepay_items: pick('is_prepayment'),
    prepay_ledger: prepayLedger,
    last_order_date: lastOrder,
    status,
  }
}
