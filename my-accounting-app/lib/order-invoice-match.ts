import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { MATCH_RULES } from '@/lib/matching-rules'
import { loadBillingFamily } from '@/lib/billing'
import { loadCanceledInvoices } from '@/lib/payment-cancel-meta'
import { loadRecordedInvoiceVat, vatCompatible, type OrderVat } from '@/lib/payment-kind-server'

// ── 주문 ↔ 매출 계산서 연결 후보 (매출 사이클 3단 대사의 가운데 변) ──────────
// 한 매출처의 "계산서 미연결 주문"과 "미배분 매출 계산서"를 놓고 조합을 찾는다.
//   A. 1:1 정확 일치 (주문 순매출 = 계산서 합계)
//   B. 합산 발행: 계산서 1장 = 주문 여러 건의 합 (몰아서 발행)
//   C. 분할 발행: 주문 1건 = 계산서 여러 장의 합 (나눠서 발행)
// 원칙: 후보만 만든다 — 연결 확정은 사용자가 한다.
// 날짜: 주문 후 발행이 원칙 — 발행일이 주문일 -7일(유예) ~ +120일 창 (30일 우선).
// 취소쌍(원+취소 합계 0, 90일 이내) 계산서는 발행 자체가 무효라 후보에서 제외한다.
// 과세 구분(1304, 2026-11-18): 주문에 구분을 적은 계산서 발행 기록이 있으면 같은 종류(과세 · 면세)의 계산서하고만 조합한다.
//   목록에는 다른 종류도 내려보내고(vat · tax_type), 화면이 접어서 보여 준다. 저장은 서버가 다시 막는다.
// 청구처(114): 본점 법인으로 계산서가 나가는 부서는 '청구처 가족' 범위에서 찾는다 —
//   부서에서 열면 주문 = 그 부서, 계산서 = 자기 것 + 청구처 법인 것
//   청구처 법인에서 열면 주문 = 법인 + 소속 부서 전부, 계산서 = 법인 것

export interface LinkOrder {
  id: string
  order_no: string
  order_date: string
  net_amount: number
  remaining: number   // 순매출 - 기연결 계산서 금액
  vendor_name?: string // 청구처 가족 범위일 때 주문처(부서) 이름
  vat?: OrderVat       // 계산서 발행 기록에 적은 과세 구분 (없으면 미기재 · 기록 없음)
}
export interface LinkInvoice {
  id: string
  issue_date: string
  total_amount: number
  item_name: string | null
  remaining: number   // 합계 - 기배분 금액
  vendor_name?: string // 청구처 법인 계산서일 때 발행 법인 이름
  tax_type?: string | null   // taxable | exempt
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
  fromDate?: string | null,  // 주문일 하한 — 화면의 조회 기간과 연동 (과거는 기간을 넓혀 실행)
): Promise<{ orders: LinkOrder[]; invoices: LinkInvoice[]; groups: LinkGroup[] } | { error: string; missingTable?: boolean }> {

  // 청구처 가족 범위 — 114 미적용이거나 지정이 없으면 이 매출처 하나
  const fam = await loadBillingFamily(admin, vendorId)
  const isRoot = fam.root === vendorId && fam.members.length > 1
  const orderVendorIds = isRoot ? fam.members : [vendorId]
  const invoiceVendorIds = fam.root !== vendorId ? [vendorId, fam.root] : [vendorId]
  const nameOf = new Map<string, string>()
  if (orderVendorIds.length > 1 || invoiceVendorIds.length > 1) {
    const ids = Array.from(new Set([...orderVendorIds, ...invoiceVendorIds]))
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await admin.from('vendors').select('id, name').in('id', ids.slice(i, i + 150))
      for (const v of data ?? []) nameOf.set(v.id as string, v.name as string)
    }
  }

  // 대상 매출처의 ERP 별칭 → 주문
  const aliasVendor = new Map<string, string>()
  for (let i = 0; i < orderVendorIds.length; i += 150) {
    const r = await fetchAllRows<{ id: string; vendor_id: string }>((f, t) =>
      admin.from('erp_vendor_aliases').select('id, vendor_id').eq('alias_type', 'customer')
        .in('vendor_id', orderVendorIds.slice(i, i + 150)).range(f, t))
    if ('error' in r) return { error: r.error }
    for (const a of r.data) aliasVendor.set(a.id, a.vendor_id)
  }
  const aliasIds = Array.from(aliasVendor.keys())

  const orderRows: { id: string; order_no: string; order_date: string; total_amount: number | null; customer_alias_id: string | null }[] = []
  for (let i = 0; i < aliasIds.length; i += 50) {
    const r = await fetchAllRows<typeof orderRows[number]>((f, t) => {
      let q = admin.from('erp_orders')
        .select('id, order_no, order_date, total_amount, customer_alias_id')
        .in('customer_alias_id', aliasIds.slice(i, i + 50))
      if (fromDate) q = q.gte('order_date', fromDate)
      return q.range(f, t)
    })
    if ('error' in r) return { error: r.error }
    orderRows.push(...r.data)
  }

  // 순매출 = 취소 · VIP · 선결제가 아닌 품목 합 (lib/receivable.ts 표준, 2026-11-18)
  //   '총액 − 제외 품목'은 쓰지 않는다 — 직접 입력 주문은 수정할 때 바뀐 품목을 취소 행으로 남기고 총액에서는 이미 빼므로
  //   취소 행을 한 번 더 빼면 순매출이 0 이하가 되어 미연결 목록에서 사라졌다(기프트 광개토 사례).
  const orderIds = orderRows.map(o => o.id)
  const netByOrder = new Map<string, number>()
  for (let i = 0; i < orderIds.length; i += 100) {
    const r = await fetchAllRows<{ order_id: string; line_total: number | null; is_canceled: boolean | null; is_vip: boolean | null; is_prepayment: boolean | null }>((f, t) =>
      admin.from('erp_order_items')
        .select('order_id, line_total, is_canceled, is_vip, is_prepayment')
        .in('order_id', orderIds.slice(i, i + 100))
        .range(f, t))
    if ('error' in r) return { error: r.error }
    for (const it of r.data) {
      if (it.is_canceled || it.is_vip || it.is_prepayment) continue
      netByOrder.set(it.order_id, (netByOrder.get(it.order_id) ?? 0) + (it.line_total ?? 0))
    }
  }

  // 매출 계산서 (양수, 취소쌍 제외) — 부서면 자기 것 + 청구처 법인 것
  const invResult = await fetchAllRows<{ id: string; issue_date: string; total_amount: number; item_name: string | null; vendor_id: string; tax_type: string | null }>((f, t) =>
    admin.from('tax_invoices')
      .select('id, issue_date, total_amount, item_name, vendor_id, tax_type')
      .eq('direction', 'sales')
      .in('vendor_id', invoiceVendorIds)
      .range(f, t))
  if ('error' in invResult) return { error: invResult.error }
  // 주문에 이미 연결된 취소쌍(원 계산서 · 취소 계산서, 1305)은 먼저 뺀다 — 남겨 두면 아래 추정이 취소 계산서를 재발행 계산서와 짝지어 재발행분을 숨긴다
  const known = await loadCanceledInvoices(admin, invResult.data.map(r => r.id))
  // 취소쌍은 발행 법인 안에서만 짝짓는다
  const invoiceRows = invoiceVendorIds.flatMap(vid =>
    excludeCancelPairs(invResult.data.filter(r => r.vendor_id === vid && !known.originals.has(r.id) && !known.cancels.has(r.id)).map(r => ({ ...r, total_amount: r.total_amount ?? 0 }))))

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

  const recVat = await loadRecordedInvoiceVat(admin, orderIds)
  const orders: LinkOrder[] = orderRows
    .map(o => {
      const net = netByOrder.get(o.id) ?? 0
      const ov = o.customer_alias_id ? aliasVendor.get(o.customer_alias_id) : undefined
      return {
        id: o.id, order_no: o.order_no, order_date: o.order_date, net_amount: net, remaining: net - (allocByOrder.get(o.id) ?? 0),
        ...(isRoot && ov ? { vendor_name: nameOf.get(ov) } : {}),
        ...(recVat.has(o.id) ? { vat: recVat.get(o.id) } : {}),
      }
    })
    .filter(o => o.remaining > 0)
    .sort((a, b) => a.order_date.localeCompare(b.order_date))

  const invoices: LinkInvoice[] = invoiceRows
    .map(r => ({
      id: r.id, issue_date: r.issue_date, total_amount: r.total_amount, item_name: r.item_name,
      remaining: r.total_amount - (allocByInvoice.get(r.id) ?? 0), tax_type: r.tax_type,
      ...(r.vendor_id !== vendorId ? { vendor_name: nameOf.get(r.vendor_id) } : {}),
    }))
    .filter(r => r.remaining > 0)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date))

  // ── 조합 탐색 (수금후보와 동일한 골격) ──
  const groups: LinkGroup[] = []
  const usedOrd = new Set<string>()
  const usedInv = new Set<string>()
  // 발행일 - 주문일 = lag, 허용 창: -PRE_GRACE ~ maxDays
  const invWindow = (o: LinkOrder, maxDays: number) => invoices.filter(v =>
    !usedInv.has(v.id) && vatCompatible(o.vat, v.tax_type) &&
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
      .filter(o => !usedOrd.has(o.id) && vatCompatible(o.vat, v.tax_type) &&
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

// ── 다른 거래처 명의 계산서 찾기 (2026-11-17 사용자 승인 — 시안 docs/mockups/계산서연결_다른거래처_시안.html) ──
// 출장소 주문의 계산서가 지점 명의로 발행되는 경우처럼, 계산서가 주문의 매출처 · 청구처가 아닌 거래처에 붙어 있으면
// 연결 창 목록에 나오지 않는다. 금액 · 발행일 · 상호로 전체 매출 계산서에서 찾는다(후보만 — 연결 확정은 사용자).
//   · 양수 계산서, 남은 금액(합계 − 기배분) > 0, 취소쌍(같은 거래처의 −같은 금액, 90일 이내) 제외
//   · amounts: 남은 금액이 이 중 하나와 같은 것만(합계로 1차 조회 후 잔액으로 거른다) / 없으면 금액 조건 없음
export interface FoundInvoice extends LinkInvoice {
  counterparty_name: string | null
  vendor_id: string | null
}

export async function searchSalesInvoices(
  admin: SupabaseClient,
  opts: { amounts?: number[]; from?: string | null; to?: string | null; q?: string | null; excludeVendorIds?: string[]; limit?: number },
): Promise<{ data: FoundInvoice[] } | { error: string }> {
  type Row = { id: string; issue_date: string; total_amount: number | null; item_name: string | null; vendor_id: string | null; counterparty_name: string | null; tax_type: string | null }
  const amounts = Array.from(new Set((opts.amounts ?? []).filter(a => a > 0)))
  const q = (opts.q ?? '').trim()
  const rows: Row[] = []
  const amountChunks = amounts.length ? Array.from({ length: Math.ceil(amounts.length / 100) }, (_, i) => amounts.slice(i * 100, i * 100 + 100)) : [null]
  for (const ch of amountChunks) {
    const r = await fetchAllRows<Row>((f, t) => {
      let s = admin.from('tax_invoices')
        .select('id, issue_date, total_amount, item_name, vendor_id, counterparty_name, tax_type')
        .eq('direction', 'sales').gt('total_amount', 0).order('issue_date', { ascending: false })
      if (ch) s = s.in('total_amount', ch)
      if (opts.from) s = s.gte('issue_date', opts.from)
      if (opts.to) s = s.lte('issue_date', opts.to)
      if (q) s = s.ilike('counterparty_name', `%${q}%`)
      return s.range(f, t)
    })
    if ('error' in r) return { error: r.error }
    rows.push(...r.data)
    if (!ch && rows.length > 2000) break
  }
  const exclude = new Set(opts.excludeVendorIds ?? [])
  let cand = rows.filter(r => !(r.vendor_id && exclude.has(r.vendor_id)))
  if (!amounts.length) cand = cand.slice(0, 500)   // 금액 조건이 없으면 최근 것부터 상한

  // 취소쌍 제외
  const totals = Array.from(new Set(cand.map(r => -(r.total_amount ?? 0))))
  const negs: { id: string; vendor_id: string | null; total_amount: number; issue_date: string }[] = []
  for (let i = 0; i < totals.length; i += 100) {
    const { data, error } = await admin.from('tax_invoices').select('id, vendor_id, total_amount, issue_date')
      .eq('direction', 'sales').in('total_amount', totals.slice(i, i + 100))
    if (error) return { error: error.message }
    negs.push(...((data ?? []) as typeof negs))
  }
  // 이미 주문에 연결된 취소쌍(1305)은 짝이 정해져 있다 — 그 취소 계산서로 다른 계산서(재발행분)를 지우지 않는다
  const knownPairs = await loadCanceledInvoices(admin, [...cand.map(r => r.id), ...negs.map(n => n.id)])
  cand = cand.filter(r => !knownPairs.originals.has(r.id))
  cand = cand.filter(r => !negs.some(n => !knownPairs.cancels.has(n.id) && n.vendor_id === r.vendor_id && n.total_amount === -(r.total_amount ?? 0)
    && Math.abs(dayDiff(n.issue_date, r.issue_date)) <= CANCEL_PAIR_DAYS))

  // 남은 금액
  const alloc = new Map<string, number>()
  const ids = cand.map(r => r.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from('erp_order_invoices').select('tax_invoice_id, amount').in('tax_invoice_id', ids.slice(i, i + 100))
    if (error) return { error: error.message }
    for (const m of data ?? []) alloc.set(m.tax_invoice_id as string, (alloc.get(m.tax_invoice_id as string) ?? 0) + Number(m.amount ?? 0))
  }
  const vIds = Array.from(new Set(cand.map(r => r.vendor_id).filter((x): x is string => !!x)))
  const vName = new Map<string, string>()
  for (let i = 0; i < vIds.length; i += 150) {
    const { data } = await admin.from('vendors').select('id, name').in('id', vIds.slice(i, i + 150))
    for (const v of data ?? []) vName.set(v.id as string, v.name as string)
  }
  const want = amounts.length ? new Set(amounts) : null
  const out: FoundInvoice[] = cand
    .map(r => ({
      id: r.id, issue_date: r.issue_date, total_amount: r.total_amount ?? 0, item_name: r.item_name,
      remaining: (r.total_amount ?? 0) - (alloc.get(r.id) ?? 0),
      counterparty_name: r.counterparty_name, vendor_id: r.vendor_id, tax_type: r.tax_type,
      vendor_name: r.vendor_id ? vName.get(r.vendor_id) ?? r.counterparty_name ?? '(이름 없음)' : `${r.counterparty_name ?? '상호 없음'} (거래처 미연결)`,
    }))
    .filter(r => r.remaining > 0 && (!want || want.has(r.remaining)))
  return { data: out.slice(0, opts.limit ?? 100) }
}

// 발행일이 주문일 기준 추천 창(−7일 ~ +120일) 안인지 — 계산서 확인 탭의 후보 판정이 연결 창 추천과 같은 기준을 쓴다
export const inInvoiceWindow = (issueDate: string, orderDate: string) => {
  const lag = dayDiff(issueDate, orderDate)
  return lag >= -PRE_GRACE && lag <= FAR
}
