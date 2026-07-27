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

export type HubStatus = 'vip' | 'normal' | 'outstanding' | 'late' | 'over90' | 'dormant'

export interface HubListRow {
  vendor_id: string
  vendor_name: string
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
  const aliasResult = await fetchAllRows<{ id: string; vendor_id: string }>((f, t) =>
    admin.from('erp_vendor_aliases').select('id, vendor_id')
      .eq('alias_type', 'customer').not('vendor_id', 'is', null).range(f, t))
  if ('error' in aliasResult) return aliasResult
  const aliasToVendor = new Map(aliasResult.data.map(a => [a.id, a.vendor_id]))
  const aliasCount = new Map<string, number>()
  for (const a of aliasResult.data) aliasCount.set(a.vendor_id, (aliasCount.get(a.vendor_id) ?? 0) + 1)

  // 전체 주문 (기간 집계 + 최근 주문일·휴면 판정을 한 번에)
  const ordersResult = await fetchAllRows<OrderLite>((f, t) =>
    admin.from('erp_orders')
      .select('id, order_no, order_date, customer_alias_id, total_amount, outstanding_amount, staff_name')
      .not('customer_alias_id', 'is', null)
      .range(f, t))
  if ('error' in ordersResult) return ordersResult

  const flagged = await loadFlaggedLines(admin)
  if ('error' in flagged) return flagged

  const vendorsResult = await fetchAllRows<{ id: string; name: string; card_numbers: string[] | null }>((f, t) =>
    admin.from('vendors').select('id, name, card_numbers').range(f, t))
  if ('error' in vendorsResult) return vendorsResult
  const vInfo = new Map(vendorsResult.data.map(v => [v.id, v]))

  // 담당직원(현재 배정) — 주담당 우선
  const staffResult = await fetchAllRows<{ vendor_id: string; is_primary: boolean; employees: unknown }>((f, t) =>
    admin.from('vendor_staff').select('vendor_id, is_primary, employees(name)')
      .is('ended_at', null).range(f, t))
  if ('error' in staffResult) return staffResult
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

  for (const o of ordersResult.data) {
    const vid = aliasToVendor.get(o.customer_alias_id as string)
    if (!vid) continue
    const a = get(vid)
    if (!a.last || o.order_date > a.last) a.last = o.order_date
    const flags = flagged.data.get(o.id)
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
    else if (a.vip_total > 0) status = 'vip'
    else status = 'normal'
    rows.push({
      vendor_id: vid,
      vendor_name: v?.name ?? '(삭제된 거래처)',
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

// .in() URL 폭발 방지 — ID 배열을 청크로 나눠 조회
async function fetchByIds<T>(
  ids: string[],
  chunk: number,
  page: (slice: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunk) {
    const { data, error } = await page(ids.slice(i, i + chunk))
    if (error) return { error: error.message }
    out.push(...(data ?? []))
  }
  return { data: out }
}

export async function buildHubDetail(
  admin: SupabaseClient,
  vendorId: string,
  fromDate: string | null,
  toDate: string | null,
): Promise<HubDetail | { error: string }> {
  const { data: vendor, error: vErr } = await admin
    .from('vendors').select('id, name, biz_number, note, card_numbers').eq('id', vendorId).single()
  if (vErr) return { error: vErr.message }

  const { data: aliases, error: aErr } = await admin
    .from('erp_vendor_aliases').select('id').eq('alias_type', 'customer').eq('vendor_id', vendorId)
  if (aErr) return { error: aErr.message }
  const aliasIds = (aliases ?? []).map(a => a.id as string)

  const { data: opening } = await admin
    .from('vendor_opening_balances').select('amount, collected_amount').eq('vendor_id', vendorId).maybeSingle()
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
  const itemsR = await fetchByIds<ItemRow>(orderIds, 60, slice =>
    admin.from('erp_order_items')
      .select('order_id, item_name, quantity, line_total, is_canceled, is_vip, is_prepayment, is_shipping_exempt, tracking_number, delivery_status')
      .in('order_id', slice))
  if ('error' in itemsR) return itemsR
  const itemsByOrder = new Map<string, ItemRow[]>()
  for (const it of itemsR.data) {
    const arr = itemsByOrder.get(it.order_id) ?? []
    arr.push(it); itemsByOrder.set(it.order_id, arr)
  }

  // 계산서 연결(067) — 미적용 환경 폴백 0
  const invAlloc = new Map<string, number>()
  {
    const r = await fetchByIds<{ order_id: string; amount: number }>(orderIds, 60, slice =>
      admin.from('erp_order_invoices').select('order_id, amount').in('order_id', slice))
    if (!('error' in r)) for (const m of r.data) invAlloc.set(m.order_id, (invAlloc.get(m.order_id) ?? 0) + m.amount)
  }

  // 주문 수금배분
  const payAlloc = new Map<string, number>()
  const allocEvents: { order_id: string; amount: number; paid_date: string | null; memo: string | null }[] = []
  {
    const r = await fetchByIds<{ order_id: string; amount: number; paid_date: string | null; memo: string | null }>(orderIds, 60, slice =>
      admin.from('erp_payment_matches').select('order_id, amount, paid_date, memo').in('order_id', slice))
    if ('error' in r) return r
    for (const m of r.data) {
      payAlloc.set(m.order_id, (payAlloc.get(m.order_id) ?? 0) + m.amount)
      allocEvents.push(m)
    }
  }

  // 매출 계산서 + 매칭 입금
  const invR = await fetchAllRows<{ id: string; issue_date: string; total_amount: number | null; payment_status: string; tax_type: string | null }>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, total_amount, payment_status, tax_type')
      .eq('direction', 'sales').eq('vendor_id', vendorId)
      .order('issue_date', { ascending: false })
      .range(f, t))
  if ('error' in invR) return invR
  const invoiceIds = invR.data.map(i => i.id)
  const invDate = new Map(invR.data.map(i => [i.id, i.issue_date]))

  const tipR = await fetchByIds<{ tax_invoice_id: string; transaction_id: string; amount: number }>(invoiceIds, 60, slice =>
    admin.from('tax_invoice_payments').select('tax_invoice_id, transaction_id, amount').in('tax_invoice_id', slice))
  if ('error' in tipR) return tipR
  const txIds = Array.from(new Set(tipR.data.map(p => p.transaction_id)))
  const txR = await fetchByIds<{ id: string; tx_date: string; description: string | null }>(txIds, 60, slice =>
    admin.from('transactions').select('id, tx_date, description').in('id', slice))
  if ('error' in txR) return txR
  const txInfo = new Map(txR.data.map(t => [t.id, t]))

  // 카드매출 (승인 기준, 취소 제외)
  const cardR = await fetchAllRows<{ id: string; tx_date: string; amount: number | null; transaction_type: string | null; cancelled_at: string | null; acquirer: string | null; card_number: string | null; approval_number: string | null }>((f, t) =>
    admin.from('card_sales')
      .select('id, tx_date, amount, transaction_type, cancelled_at, acquirer, card_number, approval_number')
      .eq('vendor_id', vendorId)
      .order('tx_date', { ascending: false })
      .range(f, t))
  if ('error' in cardR) return cardR
  const cardOk = cardR.data.filter(c => !c.cancelled_at && (c.transaction_type ?? '승인') !== '취소')

  // 선결제 원장 (erp_prepayments, 매출처 별칭 기준)
  const prepayLedger: HubPrepayEntry[] = []
  let prepayDeposit = 0, prepayDeduction = 0
  if (aliasIds.length) {
    const r = await fetchAllRows<{ entry_date: string; entry_type: 'deposit' | 'deduction'; amount: number | null; memo: string | null }>((f, t) =>
      admin.from('erp_prepayments')
        .select('entry_date, entry_type, amount, memo')
        .eq('direction', 'customer')
        .in('alias_id', aliasIds)
        .order('entry_date', { ascending: false })
        .range(f, t))
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
  const { data: staffRows, error: sErr } = await admin
    .from('vendor_staff')
    .select('id, employee_id, is_primary, started_at, employees(name, team)')
    .eq('vendor_id', vendorId).is('ended_at', null)
  if (sErr) return { error: sErr.message }
  const empIds = (staffRows ?? []).map(s => s.employee_id as string)
  const vendorCountByEmp = new Map<string, number>()
  if (empIds.length) {
    const r = await fetchByIds<{ employee_id: string }>(empIds, 60, slice =>
      admin.from('vendor_staff').select('employee_id').in('employee_id', slice).is('ended_at', null))
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
  const { data: caRows, error: caErr } = await admin
    .from('contact_assignments')
    .select('id, contact_id, title, role_memo, is_representative, started_at, ended_at, contacts(name, phone, email)')
    .eq('vendor_id', vendorId)
    .order('ended_at', { ascending: true, nullsFirst: true })
    .order('is_representative', { ascending: false })
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
  else if (vipTotal > 0) status = 'vip'
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
