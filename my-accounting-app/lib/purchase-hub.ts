import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { contactLabel } from '@/lib/contact-label'

// ─────────────────────────────────────────────────────────
// 매입처 허브 집계 (docs/purchase-hub-track.md)
//
// 기준(원본데이터 우선):
//  - 기간 매입   = 매입 세금계산서 총액(부가세 포함, 발행일 기준)
//  - 지급        = 계산서 연결 지급(tax_invoice_payments)
//                  + 미지급금(2001) 상계 확정 출금 중 계산서 연결 없는 것
//                  (060 purchase_cycle_summary와 동일 규칙 — 이중집계 방지)
//  - 미지급 잔액 = 기초원장(purchase_opening_balances) 기준일 컷오프 방식:
//                  기초잔액 + 기준일 이후 계산서(+) - 기준일 이후 지급(-)
//                  기준일 이전 원본은 제외(이중계상 방지). 음수 = 과다지급.
//                  601 보강: 기준일 이전 발행 계산서에 연결된 지급은 지급일이
//                  기준일 이후라도 제외 — 그 채무는 기초잔액에 이미 확정되어 있다.
//  - FIFO: 지급이 기초잔액을 먼저 갚고, 남은 몫이 계산서를 오래된 순으로 커버
//  - ERP 발주    = erp_order_items.purchase_total (취소 제외, 정산월 우선 귀속)
//                  — 발주 관점 매입 규모(보조 지표, 잔액 계산과 무관)
//  - 카드 매입   = card_expenses 중 가맹점 사업자번호 = 매입처 사업자번호
//                  (보조 지표 — 카드 대금은 카드사에 지급되므로 잔액과 무관)
//  - 휴면: 최근 매입(계산서 ∪ ERP 발주)이 DORMANT_MONTHS 이전
//
// 규칙은 600_purchase_hub.sql의 hub_purchase_summary와 항상 일치해야 한다.
// 매출처 허브(lib/vendor-hub.ts)는 수정하지 않는다 — 필요한 로직은 여기서 새로 만든다.
// ─────────────────────────────────────────────────────────

export const DORMANT_MONTHS = 6

export type PurchaseHubStatus = 'normal' | 'unpaid' | 'over90' | 'overpaid' | 'dormant'

export interface PurchaseHubListRow {
  vendor_id: string
  vendor_name: string
  biz_number: string | null
  alias_names: string[]     // ERP 매입처 표기 검색용
  alias_count: number
  staff_primary: string | null
  staff_extra: number
  contact_rep: string | null
  contact_extra: number
  invoice_count: number     // 기간 매입 계산서 건수
  invoice_total: number     // 기간 매입 (계산서 총액)
  erp_amount: number        // 기간 ERP 발주 규모
  paid_amount: number       // 기간 지급액
  outstanding: number       // 누적 미지급 잔액 (음수 = 과다지급)
  over90: number            // 발행 90일 초과 계산서의 미지급 잔여
  opening_remain: number    // 기초이월 미지급 잔여 (outstanding에 포함)
  last_purchase_date: string | null
  status: PurchaseHubStatus
}

export interface PurchaseHubListSummary {
  active_vendors: number
  invoice_total: number
  paid_total: number
  outstanding_total: number   // 양수 잔액 합
  over90_total: number
  pay_ratio: number
  unlinked_items: number      // ERP 품목 매입처 표기만 있고 별칭 미연결
  unlinked_aliases: number    // 매입 별칭 중 거래처 미연결
}

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

// 대형 테이블 전량 조회를 페이지 병렬로 수행 (vendor-hub와 동일 패턴, 독립 구현)
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

// .in() URL 폭발 방지 — ID 배열을 청크로 나눠 조회, 청크 안에서도 range로 끝까지 읽는다
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

// 미지급금(2001) 계정 id — 상계 확정 출금 인식용
async function payableAccountId(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.from('accounts').select('id').eq('code', '2001').maybeSingle()
  return (data?.id as string | undefined) ?? null
}

interface OpeningRow { vendor_id: string; as_of_date: string; amount: number; note: string | null }

// 기초원장 조회 — 600 미적용 환경이면 빈 목록으로 동작
async function loadOpenings(admin: SupabaseClient): Promise<Map<string, OpeningRow>> {
  const { data, error } = await admin
    .from('purchase_opening_balances')
    .select('vendor_id, as_of_date, amount, note')
  if (error || !data) return new Map()
  return new Map(data.map(o => [o.vendor_id as string, o as OpeningRow]))
}

// ── FIFO 배분 공통 계산 ──────────────────────────────────
// 기준일 이후 지급이 기초잔액을 먼저 갚고, 남은 몫이 계산서를 오래된 순으로 커버한다.
// invoices는 발행일 오름차순 정렬 상태여야 한다.
export interface FifoResult {
  outstanding: number       // 기초잔여 + 계산서 미지급 - 과다지급 (음수 = 과다지급)
  over90: number
  opening_remain: number
  unpaidByInvoice: Map<string, number>
  aging: { b30: number; b60: number; b90: number; over90: number }
}

function computeFifo(
  invoices: { id: string; issue_date: string; total: number }[],  // 기준일 이후분, 발행일 오름차순
  paidAfterCutoff: number,
  openingAmount: number,
  asOf: string,
): FifoResult {
  const openingRemain = Math.max(0, openingAmount - paidAfterCutoff)
  let paidToInv = Math.max(0, paidAfterCutoff - openingAmount)
  const unpaidByInvoice = new Map<string, number>()
  const aging = { b30: 0, b60: 0, b90: 0, over90: 0 }
  let invUnpaid = 0
  let invTotal = 0
  for (const inv of invoices) {
    invTotal += inv.total
    const covered = Math.min(inv.total, paidToInv)
    paidToInv -= covered
    const unpaid = inv.total - covered
    unpaidByInvoice.set(inv.id, unpaid)
    if (unpaid > 0) {
      invUnpaid += unpaid
      const age = Math.floor((new Date(asOf).getTime() - new Date(inv.issue_date).getTime()) / 86400000)
      if (age <= 30) aging.b30 += unpaid
      else if (age <= 60) aging.b60 += unpaid
      else if (age <= 90) aging.b90 += unpaid
      else aging.over90 += unpaid
    }
  }
  const overpaid = Math.max(0, paidAfterCutoff - openingAmount - invTotal)
  return {
    outstanding: openingRemain + invUnpaid - overpaid,
    over90: aging.over90,
    opening_remain: openingRemain,
    unpaidByInvoice,
    aging,
  }
}

function judgeStatus(
  outstanding: number, over90: number, last: string | null, dormantBefore: string,
): PurchaseHubStatus {
  if (!last || last < dormantBefore) return 'dormant'
  if (outstanding < 0) return 'overpaid'
  if (over90 > 0) return 'over90'
  if (outstanding > 0) return 'unpaid'
  return 'normal'
}

// ── 지급 이벤트 로딩 (목록 폴백·상세 공용 원천) ─────────────
// linked_issue = 연결된 계산서의 발행일 (연결 없는 2001 상계 출금은 null) — 컷오프 판정용
interface PayEvent { vendor_id: string; tx_date: string; amount: number; linked_issue: string | null }

// 컷오프 지급 인식 규칙 (600/601과 동일해야 한다):
// 지급일이 기준일 이후이고, 연결 계산서가 있다면 그 발행일도 기준일 이후여야 집계
const paidCountsAfterCutoff = (cutoff: string | null, tx_date: string, linked_issue: string | null) =>
  !cutoff || (!!tx_date && tx_date > cutoff && (!linked_issue || linked_issue > cutoff))

// ── 목록 ─────────────────────────────────────────────────
export async function buildPurchaseHubList(
  admin: SupabaseClient,
  fromDate: string | null,
  toDate: string | null,
): Promise<{ rows: PurchaseHubListRow[]; summary: PurchaseHubListSummary } | { error: string }> {
  // 보조 데이터(별칭·거래처·담당·담당자·미연결 카운트)는 집계와 병렬로 진행
  const sidePromise = Promise.all([
    fetchAllRows<{ id: string; vendor_id: string | null; erp_name: string | null }>((f, t) =>
      admin.from('erp_vendor_aliases').select('id, vendor_id, erp_name')
        .eq('alias_type', 'purchase').range(f, t)),
    fetchAllRows<{ id: string; name: string; biz_number: string | null }>((f, t) =>
      admin.from('vendors').select('id, name, biz_number').range(f, t)),
    fetchAllRows<{ vendor_id: string; is_primary: boolean; employees: unknown }>((f, t) =>
      admin.from('vendor_staff').select('vendor_id, is_primary, employees(name)')
        .is('ended_at', null).range(f, t)),
    fetchAllRows<{ vendor_id: string; is_representative: boolean; title: string | null; contacts: unknown }>((f, t) =>
      admin.from('contact_assignments').select('vendor_id, is_representative, title, contacts(name)')
        .is('ended_at', null).range(f, t)),
    admin.from('erp_order_items').select('id', { count: 'exact', head: true })
      .not('purchase_vendor_name', 'is', null).is('purchase_alias_id', null),
  ])

  // DB 집계 RPC 우선 (600) — 미적용이면 전량 조회 폴백
  type RpcRow = {
    vendor_id: string; invoice_count: number; invoice_total: number; erp_amount: number
    paid_amount: number; outstanding: number; over90: number; opening_remain: number
    last_purchase_date: string | null
  }
  let aggRows: RpcRow[] | null = null
  {
    const j = await admin.rpc('hub_purchase_summary_json', { p_from: fromDate, p_to: toDate })
    if (!j.error && Array.isArray(j.data)) {
      aggRows = j.data as RpcRow[]
    } else {
      const rpcAll = await fetchAllRows<RpcRow>((f, t) =>
        admin.rpc('hub_purchase_summary', { p_from: fromDate, p_to: toDate }).range(f, t))
      if (!('error' in rpcAll)) aggRows = rpcAll.data
    }
  }

  const t0 = today()
  const acc = new Map<string, RpcRow>()

  if (aggRows) {
    for (const r of aggRows) acc.set(r.vendor_id, r)
  } else {
    // JS 폴백 — RPC(600)와 동일 규칙으로 계산
    const fb = await buildListFallback(admin, fromDate, toDate, t0)
    if ('error' in fb) return fb
    for (const r of fb.data) acc.set(r.vendor_id, r)
  }

  const [aliasResult, vendorsResult, staffResult, contactResult, unlinkedItemsRes] = await sidePromise
  if ('error' in aliasResult) return aliasResult
  if ('error' in vendorsResult) return vendorsResult
  if ('error' in staffResult) return staffResult
  if ('error' in contactResult) return contactResult

  const aliasCount = new Map<string, number>()
  const aliasNames = new Map<string, string[]>()   // 검색용 (매입처당 최대 12개)
  let unlinkedAliases = 0
  for (const a of aliasResult.data) {
    if (!a.vendor_id) { unlinkedAliases++; continue }
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
    else if (name) { if (e.primary) e.extra++; else e.primary = name }
  }
  const contactByVendor = new Map<string, { rep: string | null; extra: number }>()
  for (const c of contactResult.data) {
    const name = (c.contacts as { name?: string } | null)?.name ?? null
    const label = name ? contactLabel(name, c.title) : null
    let e = contactByVendor.get(c.vendor_id)
    if (!e) { e = { rep: null, extra: 0 }; contactByVendor.set(c.vendor_id, e) }
    if (c.is_representative && label) { if (e.rep) e.extra++; e.rep = label }
    else if (label) { if (e.rep) e.extra++; else e.rep = label }
  }

  const dormantBefore = addDays(t0, -DORMANT_MONTHS * 30)
  const rows: PurchaseHubListRow[] = []
  for (const [vid, a] of Array.from(acc.entries())) {
    const v = vInfo.get(vid)
    const st = staffByVendor.get(vid)
    const ct = contactByVendor.get(vid)
    rows.push({
      vendor_id: vid,
      vendor_name: v?.name ?? '(삭제된 거래처)',
      biz_number: v?.biz_number ?? null,
      alias_names: aliasNames.get(vid) ?? [],
      alias_count: aliasCount.get(vid) ?? 0,
      staff_primary: st?.primary ?? null,
      staff_extra: st?.extra ?? 0,
      contact_rep: ct?.rep ?? null,
      contact_extra: ct?.extra ?? 0,
      invoice_count: a.invoice_count,
      invoice_total: a.invoice_total,
      erp_amount: a.erp_amount,
      paid_amount: a.paid_amount,
      outstanding: a.outstanding,
      over90: a.over90,
      opening_remain: a.opening_remain,
      last_purchase_date: a.last_purchase_date,
      status: judgeStatus(a.outstanding, a.over90, a.last_purchase_date, dormantBefore),
    })
  }
  rows.sort((x, y) => y.invoice_total - x.invoice_total || y.outstanding - x.outstanding)

  const active = rows.filter(r => r.invoice_count > 0 || r.erp_amount > 0)
  const invTotal = active.reduce((s, r) => s + r.invoice_total, 0)
  const paidTotal = active.reduce((s, r) => s + r.paid_amount, 0)
  return {
    rows,
    summary: {
      active_vendors: active.length,
      invoice_total: invTotal,
      paid_total: paidTotal,
      outstanding_total: rows.reduce((s, r) => s + Math.max(0, r.outstanding), 0),
      over90_total: rows.reduce((s, r) => s + r.over90, 0),
      pay_ratio: invTotal > 0 ? Math.min(1, paidTotal / invTotal) : 1,
      unlinked_items: unlinkedItemsRes.count ?? 0,
      unlinked_aliases: unlinkedAliases,
    },
  }
}

// JS 폴백 — 600 RPC와 동일 규칙 (기간 지표는 컷오프 무관, 잔액은 컷오프 반영)
async function buildListFallback(
  admin: SupabaseClient,
  fromDate: string | null,
  toDate: string | null,
  t0: string,
): Promise<{ data: {
  vendor_id: string; invoice_count: number; invoice_total: number; erp_amount: number
  paid_amount: number; outstanding: number; over90: number; opening_remain: number
  last_purchase_date: string | null
}[] } | { error: string }> {
  const inPeriod = (d: string | null) => !!d && (!fromDate || d >= fromDate) && (!toDate || d <= toDate)

  const [invR, tipR, acc2001, openings] = await Promise.all([
    fetchAllRows<{ id: string; vendor_id: string; issue_date: string; total_amount: number | null }>((f, t) =>
      admin.from('tax_invoices').select('id, vendor_id, issue_date, total_amount')
        .eq('direction', 'purchase').not('vendor_id', 'is', null).range(f, t)),
    fetchAllRows<{ tax_invoice_id: string; transaction_id: string; amount: number }>((f, t) =>
      admin.from('tax_invoice_payments').select('tax_invoice_id, transaction_id, amount').range(f, t)),
    payableAccountId(admin),
    loadOpenings(admin),
  ])
  if ('error' in invR) return invR
  if ('error' in tipR) return tipR

  const invById = new Map(invR.data.map(i => [i.id, i]))
  const linkedTxIds = new Set(tipR.data.map(p => p.transaction_id))

  // 계산서 연결 지급의 거래일
  const tipTxIds = Array.from(new Set(tipR.data
    .filter(p => invById.has(p.tax_invoice_id))
    .map(p => p.transaction_id)))
  const txR = await fetchByIds<{ id: string; tx_date: string }>(tipTxIds, 100, (slice, f, t) =>
    admin.from('transactions').select('id, tx_date').in('id', slice).range(f, t))
  if ('error' in txR) return txR
  const txDate = new Map(txR.data.map(t => [t.id, t.tx_date]))

  const payEvents: PayEvent[] = []
  for (const p of tipR.data) {
    const inv = invById.get(p.tax_invoice_id)
    if (!inv) continue
    payEvents.push({ vendor_id: inv.vendor_id, tx_date: txDate.get(p.transaction_id) ?? '', amount: p.amount, linked_issue: inv.issue_date })
  }
  // 미지급금(2001) 상계 확정 출금 중 계산서 연결 없는 것
  // 카드사 거래처는 제외 — 카드대금 출금은 계산서 지급이 아니다 (601과 동일 규칙)
  if (acc2001) {
    const [r, cardVendorsR] = await Promise.all([
      fetchAllRows<{ id: string; vendor_id: string; tx_date: string; amount_out: number | null }>((f, t) =>
        admin.from('transactions').select('id, vendor_id, tx_date, amount_out')
          .eq('status', 'confirmed').eq('confirmed_account_id', acc2001)
          .not('vendor_id', 'is', null).gt('amount_out', 0).range(f, t)),
      admin.from('card_accounts').select('vendor_id').not('vendor_id', 'is', null),
    ])
    if ('error' in r) return r
    const cardVendors = new Set((cardVendorsR.data ?? []).map(c => c.vendor_id as string))
    for (const tx of r.data) {
      if (linkedTxIds.has(tx.id)) continue
      if (cardVendors.has(tx.vendor_id)) continue
      payEvents.push({ vendor_id: tx.vendor_id, tx_date: tx.tx_date, amount: tx.amount_out ?? 0, linked_issue: null })
    }
  }

  // ERP 발주 — 정산월 우선 귀속 (주문일은 병렬 전량 조회로 보강)
  const [itemsR, ordersR] = await Promise.all([
    fetchAllParallel<{ purchase_alias_id: string; order_id: string; purchase_total: number | null; settlement_month: string | null }>(
      () => admin.from('erp_order_items').select('id', { count: 'exact', head: true })
        .not('purchase_alias_id', 'is', null).eq('is_canceled', false),
      (f, t) => admin.from('erp_order_items')
        .select('purchase_alias_id, order_id, purchase_total, settlement_month')
        .not('purchase_alias_id', 'is', null).eq('is_canceled', false).range(f, t)),
    fetchAllParallel<{ id: string; order_date: string }>(
      () => admin.from('erp_orders').select('id', { count: 'exact', head: true }),
      (f, t) => admin.from('erp_orders').select('id, order_date').range(f, t)),
  ])
  if ('error' in itemsR) return itemsR
  if ('error' in ordersR) return ordersR
  const orderDate = new Map(ordersR.data.map(o => [o.id, o.order_date]))
  const aliasR = await fetchAllRows<{ id: string; vendor_id: string | null }>((f, t) =>
    admin.from('erp_vendor_aliases').select('id, vendor_id')
      .eq('alias_type', 'purchase').not('vendor_id', 'is', null).range(f, t))
  if ('error' in aliasR) return aliasR
  const aliasVendor = new Map(aliasR.data.map(a => [a.id, a.vendor_id as string]))

  interface Acc {
    invoice_count: number; invoice_total: number; erp_amount: number; paid_amount: number
    last: string | null
    invs: { id: string; issue_date: string; total: number }[]
    paidAfter: number
  }
  const acc = new Map<string, Acc>()
  const get = (vid: string): Acc => {
    let a = acc.get(vid)
    if (!a) {
      a = { invoice_count: 0, invoice_total: 0, erp_amount: 0, paid_amount: 0, last: null, invs: [], paidAfter: 0 }
      acc.set(vid, a)
    }
    return a
  }

  for (const inv of invR.data) {
    const a = get(inv.vendor_id)
    const total = inv.total_amount ?? 0
    if (!a.last || inv.issue_date > a.last) a.last = inv.issue_date
    if (inPeriod(inv.issue_date)) { a.invoice_count++; a.invoice_total += total }
    const cutoff = openings.get(inv.vendor_id)?.as_of_date ?? null
    if (!cutoff || inv.issue_date > cutoff) a.invs.push({ id: inv.id, issue_date: inv.issue_date, total })
  }
  for (const p of payEvents) {
    const a = get(p.vendor_id)
    if (inPeriod(p.tx_date)) a.paid_amount += p.amount
    const cutoff = openings.get(p.vendor_id)?.as_of_date ?? null
    if (paidCountsAfterCutoff(cutoff, p.tx_date, p.linked_issue)) a.paidAfter += p.amount
  }
  for (const it of itemsR.data) {
    const vid = aliasVendor.get(it.purchase_alias_id)
    if (!vid) continue
    const a = get(vid)
    const sm = (it.settlement_month ?? '').slice(0, 7)
    const pdate = sm ? `${sm}-01` : (orderDate.get(it.order_id) ?? null)
    if (pdate && (!a.last || pdate > a.last)) a.last = pdate
    if (inPeriod(pdate)) a.erp_amount += it.purchase_total ?? 0
  }
  for (const [vid] of Array.from(openings.entries())) get(vid)

  const out: {
    vendor_id: string; invoice_count: number; invoice_total: number; erp_amount: number
    paid_amount: number; outstanding: number; over90: number; opening_remain: number
    last_purchase_date: string | null
  }[] = []
  for (const [vid, a] of Array.from(acc.entries())) {
    a.invs.sort((x, y) => x.issue_date.localeCompare(y.issue_date))
    const fifo = computeFifo(a.invs, a.paidAfter, openings.get(vid)?.amount ?? 0, t0)
    out.push({
      vendor_id: vid,
      invoice_count: a.invoice_count,
      invoice_total: a.invoice_total,
      erp_amount: a.erp_amount,
      paid_amount: a.paid_amount,
      outstanding: fifo.outstanding,
      over90: fifo.over90,
      opening_remain: fifo.opening_remain,
      last_purchase_date: a.last,
    })
  }
  return { data: out }
}

// ── 상세 ─────────────────────────────────────────────────

export interface PurchaseHubInvoiceRow {
  id: string
  issue_date: string
  tax_type: string | null
  supply_amount: number
  total_amount: number
  payment_status: string
  paid_alloc: number        // 계산서 연결 지급 합
  unpaid: number            // FIFO 배분 후 미지급 잔여
}

export interface PurchaseHubTimelineEvent {
  kind: 'invoice' | 'bank' | 'card'
  date: string
  label: string
  amount: number
  ref_id: string | null
}

export interface PurchaseHubErpMonth {
  month: string             // 정산월(없으면 주문월)
  item_count: number
  amount: number
}

export interface PurchaseHubErpItem {
  order_no: string | null
  order_date: string | null
  item_name: string | null
  quantity: number
  purchase_total: number
  settlement_month: string | null
  is_canceled: boolean
}

export interface PurchaseHubDetail {
  vendor: { id: string; name: string; biz_number: string | null; note: string | null }
  links: {
    alias_count: number
    opening: { as_of_date: string; amount: number; note: string | null } | null
  }
  staff: {
    id: string; employee_id: string; name: string; team: string | null
    is_primary: boolean; started_at: string | null; vendor_count: number
  }[]
  contacts: {
    assignment_id: string; contact_id: string; name: string; phone: string | null; email: string | null
    title: string | null; role_memo: string | null; is_representative: boolean
    started_at: string | null; ended_at: string | null
  }[]
  kpi: {
    invoice_total: number   // 기간 매입 (계산서 총액)
    paid_total: number      // 기간 지급
    outstanding: number     // 누적 미지급 잔액 (음수 = 과다지급)
    opening_remain: number
    erp_amount: number      // 기간 ERP 발주
    card_total: number      // 기간 카드 매입 (사업자번호 매칭)
    avg_pay_days: number | null  // 계산서 발행→지급 (금액 가중)
  }
  aging: { b30: number; b60: number; b90: number; over90: number; opening: number }
  invoices: PurchaseHubInvoiceRow[]
  timeline: PurchaseHubTimelineEvent[]
  erp_months: PurchaseHubErpMonth[]
  erp_items: PurchaseHubErpItem[]
  last_purchase_date: string | null
  status: PurchaseHubStatus
}

export async function buildPurchaseHubDetail(
  admin: SupabaseClient,
  vendorId: string,
  fromDate: string | null,
  toDate: string | null,
): Promise<PurchaseHubDetail | { error: string }> {
  const inPeriod = (d: string | null) => !!d && (!fromDate || d >= fromDate) && (!toDate || d <= toDate)

  const [vendorRes, aliasRes, acc2001] = await Promise.all([
    admin.from('vendors').select('id, name, biz_number, note').eq('id', vendorId).single(),
    admin.from('erp_vendor_aliases').select('id').eq('alias_type', 'purchase').eq('vendor_id', vendorId),
    payableAccountId(admin),
  ])
  if (vendorRes.error) return { error: vendorRes.error.message }
  if (aliasRes.error) return { error: aliasRes.error.message }
  const vendor = vendorRes.data
  const aliasIds = (aliasRes.data ?? []).map(a => a.id as string)

  // 기초원장 (600 미적용 환경이면 null)
  const openingRes = await admin.from('purchase_opening_balances')
    .select('as_of_date, amount, note').eq('vendor_id', vendorId).maybeSingle()
  const opening = openingRes.error ? null : (openingRes.data as { as_of_date: string; amount: number; note: string | null } | null)
  const cutoff = opening?.as_of_date ?? null

  // 매입 계산서 (전체 — 기간 필터는 메모리)
  const invR = await fetchAllRows<{ id: string; issue_date: string; tax_type: string | null; supply_amount: number | null; total_amount: number | null; payment_status: string }>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, tax_type, supply_amount, total_amount, payment_status')
      .eq('direction', 'purchase').eq('vendor_id', vendorId)
      .order('issue_date', { ascending: false })
      .range(f, t))
  if ('error' in invR) return invR
  const invoiceIds = invR.data.map(i => i.id)
  const invDate = new Map(invR.data.map(i => [i.id, i.issue_date]))

  // 계산서 연결 지급 + 거래 정보
  const tipR = await fetchByIds<{ tax_invoice_id: string; transaction_id: string; amount: number }>(invoiceIds, 60, (slice, f, t) =>
    admin.from('tax_invoice_payments').select('tax_invoice_id, transaction_id, amount').in('tax_invoice_id', slice).range(f, t))
  if ('error' in tipR) return tipR
  const tipTxIds = Array.from(new Set(tipR.data.map(p => p.transaction_id)))
  const txR = await fetchByIds<{ id: string; tx_date: string; description: string | null }>(tipTxIds, 60, (slice, f, t) =>
    admin.from('transactions').select('id, tx_date, description').in('id', slice).range(f, t))
  if ('error' in txR) return txR
  const txInfo = new Map(txR.data.map(t => [t.id, t]))

  // 미지급금(2001) 상계 확정 출금 (계산서 연결 없는 것만 — 전역 연결 여부로 판정)
  // 카드사 거래처는 제외 — 카드대금 출금은 계산서 지급이 아니다 (601과 동일 규칙)
  const { data: cardAcc } = await admin.from('card_accounts')
    .select('id').eq('vendor_id', vendorId).limit(1).maybeSingle()
  let tx2001: { id: string; tx_date: string; description: string | null; amount_out: number | null }[] = []
  if (acc2001 && !cardAcc) {
    const r = await fetchAllRows<{ id: string; tx_date: string; description: string | null; amount_out: number | null }>((f, t) =>
      admin.from('transactions').select('id, tx_date, description, amount_out')
        .eq('vendor_id', vendorId).eq('status', 'confirmed').eq('confirmed_account_id', acc2001)
        .gt('amount_out', 0).range(f, t))
    if ('error' in r) return r
    if (r.data.length) {
      const linkR = await fetchByIds<{ transaction_id: string }>(r.data.map(x => x.id), 100, (slice, f, t) =>
        admin.from('tax_invoice_payments').select('transaction_id').in('transaction_id', slice).range(f, t))
      const linked = new Set(('error' in linkR) ? [] : linkR.data.map(l => l.transaction_id))
      tx2001 = r.data.filter(x => !linked.has(x.id))
    }
  }

  // 카드 매입 (가맹점 사업자번호 = 매입처 사업자번호 — 보조 지표)
  let cardRows: { id: string; tx_date: string; merchant_name: string | null; approved_amount: number | null; cancel_amount: number | null; statement_status: string | null }[] = []
  const bizDigits = digitsOf(vendor.biz_number)
  if (bizDigits.length === 10) {
    const dashed = `${bizDigits.slice(0, 3)}-${bizDigits.slice(3, 5)}-${bizDigits.slice(5)}`
    const r = await fetchAllRows<{ id: string; tx_date: string; merchant_name: string | null; approved_amount: number | null; cancel_amount: number | null; statement_status: string | null }>((f, t) =>
      admin.from('card_expenses')
        .select('id, tx_date, merchant_name, approved_amount, cancel_amount, statement_status')
        .in('merchant_biz_number', [bizDigits, dashed])
        .order('tx_date', { ascending: false })
        .range(f, t))
    if (!('error' in r)) cardRows = r.data.filter(c => !(c.statement_status ?? '').includes('취소'))
  }

  // ERP 발주 품목 (매입 별칭 기준)
  interface ItemRow {
    order_id: string; item_name: string | null; quantity: number | null
    purchase_total: number | null; settlement_month: string | null; is_canceled: boolean
  }
  let items: ItemRow[] = []
  if (aliasIds.length) {
    const r = await fetchByIds<ItemRow>(aliasIds, 60, (slice, f, t) =>
      admin.from('erp_order_items')
        .select('order_id, item_name, quantity, purchase_total, settlement_month, is_canceled')
        .in('purchase_alias_id', slice).range(f, t))
    if ('error' in r) return r
    items = r.data
  }
  const itemOrderIds = Array.from(new Set(items.map(i => i.order_id)))
  const ordR = await fetchByIds<{ id: string; order_no: string | null; order_date: string }>(itemOrderIds, 60, (slice, f, t) =>
    admin.from('erp_orders').select('id, order_no, order_date').in('id', slice).range(f, t))
  if ('error' in ordR) return ordR
  const ordInfo = new Map(ordR.data.map(o => [o.id, o]))

  // 담당직원 패널
  const staffRes = await admin.from('vendor_staff')
    .select('id, employee_id, is_primary, started_at, employees(name, team)')
    .eq('vendor_id', vendorId).is('ended_at', null)
  if (staffRes.error) return { error: staffRes.error.message }
  const staffRows = staffRes.data ?? []
  const empIds = staffRows.map(s => s.employee_id as string)
  const vendorCountByEmp = new Map<string, number>()
  if (empIds.length) {
    const r = await fetchByIds<{ employee_id: string }>(empIds, 60, (slice, f, t) =>
      admin.from('vendor_staff').select('employee_id').in('employee_id', slice).is('ended_at', null).range(f, t))
    if (!('error' in r)) for (const s of r.data) vendorCountByEmp.set(s.employee_id, (vendorCountByEmp.get(s.employee_id) ?? 0) + 1)
  }

  // 거래처 담당자 패널 (이력 포함)
  const caRes = await admin.from('contact_assignments')
    .select('id, contact_id, title, role_memo, is_representative, started_at, ended_at, contacts(name, phone, email)')
    .eq('vendor_id', vendorId)
    .order('ended_at', { ascending: true, nullsFirst: true })
    .order('is_representative', { ascending: false })
  if (caRes.error) return { error: caRes.error.message }

  // ── 집계 ──
  const t0 = today()

  // 지급 이벤트 (기간 지표·컷오프 잔액 공용)
  const payAll: { tx_date: string; amount: number; linked_issue: string | null }[] = []
  const paidByInvoice = new Map<string, number>()
  let avgWeighted = 0, avgAmount = 0
  const timeline: PurchaseHubTimelineEvent[] = []
  const seenTx = new Set<string>()
  for (const p of tipR.data) {
    const tx = txInfo.get(p.transaction_id)
    const d = tx?.tx_date ?? ''
    payAll.push({ tx_date: d, amount: p.amount, linked_issue: invDate.get(p.tax_invoice_id) ?? null })
    paidByInvoice.set(p.tax_invoice_id, (paidByInvoice.get(p.tax_invoice_id) ?? 0) + p.amount)
    const issue = invDate.get(p.tax_invoice_id)
    if (d && issue) {
      const dd = Math.round((new Date(d).getTime() - new Date(issue).getTime()) / 86400000)
      if (dd >= 0 && dd < 400) { avgWeighted += dd * p.amount; avgAmount += p.amount }
    }
    if (d && !seenTx.has(p.transaction_id)) {
      seenTx.add(p.transaction_id)
      timeline.push({ kind: 'bank', date: d, label: tx?.description ?? '출금 (계산서 매칭)', amount: p.amount, ref_id: p.transaction_id })
    }
  }
  for (const tx of tx2001) {
    payAll.push({ tx_date: tx.tx_date, amount: tx.amount_out ?? 0, linked_issue: null })
    timeline.push({ kind: 'bank', date: tx.tx_date, label: tx.description ?? '출금 (미지급금 상계)', amount: tx.amount_out ?? 0, ref_id: tx.id })
  }

  let invoiceTotalPeriod = 0
  const invsAfterCutoff: { id: string; issue_date: string; total: number }[] = []
  for (const inv of invR.data) {
    const total = inv.total_amount ?? 0
    if (inPeriod(inv.issue_date)) invoiceTotalPeriod += total
    if (!cutoff || inv.issue_date > cutoff) invsAfterCutoff.push({ id: inv.id, issue_date: inv.issue_date, total })
    timeline.push({ kind: 'invoice', date: inv.issue_date, label: '매입 세금계산서 수취', amount: total, ref_id: inv.id })
  }
  invsAfterCutoff.sort((x, y) => x.issue_date.localeCompare(y.issue_date))

  const paidAfterCutoff = payAll.reduce((s, p) => s + (paidCountsAfterCutoff(cutoff, p.tx_date, p.linked_issue) ? p.amount : 0), 0)
  const paidPeriod = payAll.reduce((s, p) => s + (inPeriod(p.tx_date) ? p.amount : 0), 0)
  const fifo = computeFifo(invsAfterCutoff, paidAfterCutoff, opening?.amount ?? 0, t0)

  // 카드 매입 (기간)
  let cardTotal = 0
  for (const c of cardRows) {
    const amt = (c.approved_amount ?? 0) - (c.cancel_amount ?? 0)
    if (inPeriod(c.tx_date)) cardTotal += amt
    timeline.push({ kind: 'card', date: c.tx_date, label: `법인카드 (${c.merchant_name ?? '가맹점 미상'})`, amount: amt, ref_id: c.id })
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date))

  // ERP 발주 — 정산월별 롤업 + 품목 목록
  let erpAmountPeriod = 0
  let lastPurchase: string | null = null
  const erpMonthMap = new Map<string, { item_count: number; amount: number }>()
  const erpItems: PurchaseHubErpItem[] = []
  for (const it of items) {
    const o = ordInfo.get(it.order_id)
    const sm = (it.settlement_month ?? '').slice(0, 7)
    const month = sm || (o?.order_date ?? '').slice(0, 7)
    const pdate = sm ? `${sm}-01` : (o?.order_date ?? null)
    if (!it.is_canceled) {
      if (pdate && (!lastPurchase || pdate > lastPurchase)) lastPurchase = pdate
      if (inPeriod(pdate)) erpAmountPeriod += it.purchase_total ?? 0
      if (month) {
        const m = erpMonthMap.get(month) ?? { item_count: 0, amount: 0 }
        m.item_count++; m.amount += it.purchase_total ?? 0
        erpMonthMap.set(month, m)
      }
    }
    erpItems.push({
      order_no: o?.order_no ?? null,
      order_date: o?.order_date ?? null,
      item_name: it.item_name,
      quantity: it.quantity ?? 0,
      purchase_total: it.purchase_total ?? 0,
      settlement_month: sm || null,
      is_canceled: it.is_canceled,
    })
  }
  erpItems.sort((a, b) => (b.order_date ?? '').localeCompare(a.order_date ?? ''))
  for (const inv of invR.data) {
    if (!lastPurchase || inv.issue_date > lastPurchase) lastPurchase = inv.issue_date
  }

  const dormantBefore = addDays(t0, -DORMANT_MONTHS * 30)
  const status = judgeStatus(fifo.outstanding, fifo.over90, lastPurchase, dormantBefore)

  return {
    vendor: { id: vendor.id, name: vendor.name, biz_number: vendor.biz_number, note: vendor.note },
    links: { alias_count: aliasIds.length, opening },
    staff: staffRows.map(s => ({
      id: s.id as string,
      employee_id: s.employee_id as string,
      name: (s.employees as { name?: string } | null)?.name ?? '(삭제된 직원)',
      team: (s.employees as { team?: string | null } | null)?.team ?? null,
      is_primary: s.is_primary as boolean,
      started_at: s.started_at as string | null,
      vendor_count: vendorCountByEmp.get(s.employee_id as string) ?? 0,
    })).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    contacts: (caRes.data ?? []).map(c => ({
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
      invoice_total: invoiceTotalPeriod,
      paid_total: paidPeriod,
      outstanding: fifo.outstanding,
      opening_remain: fifo.opening_remain,
      erp_amount: erpAmountPeriod,
      card_total: cardTotal,
      avg_pay_days: avgAmount > 0 ? Math.round(avgWeighted / avgAmount) : null,
    },
    aging: { ...fifo.aging, opening: fifo.opening_remain },
    invoices: invR.data.map(i => ({
      id: i.id,
      issue_date: i.issue_date,
      tax_type: i.tax_type,
      supply_amount: i.supply_amount ?? 0,
      total_amount: i.total_amount ?? 0,
      payment_status: i.payment_status,
      paid_alloc: paidByInvoice.get(i.id) ?? 0,
      unpaid: fifo.unpaidByInvoice.get(i.id) ?? 0,
    })),
    timeline: timeline.slice(0, 200),
    erp_months: Array.from(erpMonthMap.entries())
      .map(([month, m]) => ({ month, ...m }))
      .sort((a, b) => b.month.localeCompare(a.month)),
    erp_items: erpItems.slice(0, 500),
    last_purchase_date: lastPurchase,
    status,
  }
}
