import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { kstToday, type Editor } from './orders-portal'
import { loadReceivableMap } from './orders-portal-list'
import { loadPayStateMap } from './pay-state-server'
import type { PayState } from './pay-state'
import { honorify } from './contact-label'
import { DATA_START } from './period-presets'
import { inInvoiceWindow, searchSalesInvoices } from './order-invoice-match'
import { loadRecordedInvoiceVat, vatCompatible } from './payment-kind-server'

// ── 결제 확인 3단계 (2026-11-16 사용자 승인 — 시안 docs/mockups/결제확인_통합_시안.html) ──
//   결제 안내 대상: 결제 상태가 미결제 · 일부 결제인 주문(영업지원 작업 목록) + 연락 기록(1301)
//   계산서 확인: ① 계산서 발행 기록이 있는데 홈택스 계산서 미연결 ② 금액 다름 ③ 이체로 받았는데 증빙 없음
// 상태는 저장하지 않는다 — 조회할 때 주문 · 기록 · 매칭 · 계산서 연결에서 계산한다.

const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const dayDiff = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)
const missing = (msg: string | undefined) => !!msg && /order_payment_contacts|schema cache|does not exist/i.test(msg)
export const MIGRATION_1301_MSG = '1301 마이그레이션(연락 기록)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

export const CONTACT_METHODS = ['phone', 'sms', 'email', 'visit', 'etc'] as const
export type ContactMethod = typeof CONTACT_METHODS[number]
export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = { phone: '전화', sms: '문자', email: '메일', visit: '방문', etc: '기타' }

export interface PayContact { id: string; order_id: string; contact_date: string; method: ContactMethod; memo: string | null; promise_date: string | null; created_by_name: string | null; created_at: string }

type OrderRow = {
  id: string; order_no: string | null; order_date: string; bank_name: string | null; branch_name: string | null
  manager_name: string | null; phone: string | null; contact: string | null; staff_name: string | null
  total_amount: number | null; created_by_employee_id: string | null; counselor_employee_id: string | null
}

// 진행 중일 수 있는 주문: direct · 미취소. 기간은 자료 시작일부터(결제가 안 끝난 주문은 오래돼도 남아야 한다)
async function loadOpenOrders(admin: SupabaseClient): Promise<{ error: string } | { orders: OrderRow[]; recv: Map<string, { outstanding: number; net_sales: number }> }> {
  const res = await fetchAllRows<OrderRow>((f, t) => admin.from('erp_orders')
    .select('id, order_no, order_date, bank_name, branch_name, manager_name, phone, contact, staff_name, total_amount, created_by_employee_id, counselor_employee_id')
    .eq('source', 'direct').is('canceled_at', null).gte('order_date', DATA_START)
    .order('order_date', { ascending: true }).range(f, t))
  if ('error' in res) return { error: res.error }
  const recv = await loadReceivableMap(admin, res.data.map(o => o.id))
  if (!recv) return { error: '미수 계산 뷰(v_erp_order_receivable)를 읽지 못했습니다.' }
  return { orders: res.data, recv }
}

// ── 결제 안내 대상 ───────────────────────────────────────────────────────
export interface GuideRow {
  order_id: string; order_no: string | null; order_date: string
  customer_name: string; manager: string; phone: string; staff_name: string | null
  net: number; to_collect: number            // 받을 금액 = 주문 금액(순매출) − 기록 금액
  pay: PayState; days: number                // 주문일부터 지난 날
  last_contact: PayContact | null; contact_count: number
  promise_overdue: boolean; mine: boolean
}

export async function loadGuideRows(admin: SupabaseClient, meId: string | null): Promise<{ error: string } | { rows: GuideRow[]; contacts_available: boolean }> {
  const base = await loadOpenOrders(admin)
  if ('error' in base) return base
  const open = base.orders.filter(o => (base.recv.get(o.id)?.outstanding ?? 0) > 0)
  const payMap = await loadPayStateMap(admin, open.map(o => ({ id: o.id, canceled: false })), base.recv)
  const target = open.filter(o => { const st = payMap.get(o.id)?.stage; return st === 'unpaid' || st === 'partial_pay' })

  // 연락 기록 (1301 미적용이면 빈 목록 + available=false)
  let available = true
  const byOrder = new Map<string, PayContact[]>()
  for (const ch of chunk(target.map(o => o.id), 150)) {
    const { data, error } = await admin.from('order_payment_contacts')
      .select('id, order_id, contact_date, method, memo, promise_date, created_by_name, created_at')
      .in('order_id', ch).order('contact_date', { ascending: false }).order('created_at', { ascending: false })
    if (error) { if (missing(error.message)) { available = false; break } return { error: error.message } }
    for (const c of (data ?? []) as PayContact[]) { const l = byOrder.get(c.order_id) ?? []; l.push(c); byOrder.set(c.order_id, l) }
  }

  const today = kstToday()
  const rows: GuideRow[] = target.map(o => {
    const pay = payMap.get(o.id)!
    const net = base.recv.get(o.id)?.net_sales ?? 0
    const cs = byOrder.get(o.id) ?? []
    const last = cs[0] ?? null
    return {
      order_id: o.id, order_no: o.order_no, order_date: o.order_date,
      customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' '),
      manager: honorify(o.manager_name), phone: o.phone || o.contact || '', staff_name: o.staff_name,
      net, to_collect: Math.max(0, net - pay.recorded), pay, days: Math.max(0, dayDiff(today, o.order_date)),
      last_contact: last, contact_count: cs.length,
      // 가장 최근 연락의 약속일이 지났는데 아직 이 목록에 있으면 약속 불이행
      promise_overdue: !!last?.promise_date && last.promise_date < today,
      mine: !!meId && (o.created_by_employee_id === meId || o.counselor_employee_id === meId),
    }
  }).sort((a, b) => b.days - a.days)
  return { rows, contacts_available: available }
}

// ── 연락 기록 ────────────────────────────────────────────────────────────
export async function listContacts(admin: SupabaseClient, orderId: string): Promise<{ available: boolean; contacts: PayContact[] }> {
  const { data, error } = await admin.from('order_payment_contacts')
    .select('id, order_id, contact_date, method, memo, promise_date, created_by_name, created_at')
    .eq('order_id', orderId).order('contact_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) return { available: false, contacts: [] }
  return { available: true, contacts: (data ?? []) as PayContact[] }
}

export async function addContact(admin: SupabaseClient, orderId: string, raw: unknown, editor: Editor): Promise<{ error: string } | { ok: true }> {
  const b = (raw ?? {}) as Record<string, unknown>
  const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!isDate(b.contact_date)) return { error: '연락한 날을 입력하세요.' }
  if (b.contact_date > kstToday()) return { error: '연락한 날이 미래입니다.' }
  if (!CONTACT_METHODS.includes(b.method as ContactMethod)) return { error: '연락 방법을 고르세요.' }
  const memo = String(b.memo ?? '').trim().slice(0, 500) || null
  let promise: string | null = null
  if (b.promise_date) { if (!isDate(b.promise_date)) return { error: '입금 약속일 형식이 올바르지 않습니다.' }; promise = b.promise_date }
  if (!memo && !promise) return { error: '내용이나 입금 약속일 중 하나는 적어 주세요.' }
  const { data: o } = await admin.from('erp_orders').select('id').eq('id', orderId).maybeSingle()
  if (!o) return { error: '주문을 찾을 수 없습니다.' }
  const { error } = await admin.from('order_payment_contacts').insert({
    order_id: orderId, contact_date: b.contact_date, method: b.method, memo, promise_date: promise,
    created_by: editor.employeeId, created_by_name: editor.employeeName,
  })
  if (error) return { error: missing(error.message) ? MIGRATION_1301_MSG : error.message }
  return { ok: true }
}

// ── 계산서 확인 ──────────────────────────────────────────────────────────
export type InvoiceIssue = 'no_hometax' | 'amount_diff' | 'no_evidence'
export interface InvoiceCheckRow {
  issue: InvoiceIssue
  order_id: string; order_no: string | null; order_date: string
  customer_name: string; vendor_id: string | null; billing_name: string | null
  net: number
  record_date: string | null; record_amount: number | null   // 계산서 발행 기록 (이 주문 분)
  invoice_amount: number                                       // 주문에 연결된 홈택스 계산서 금액 합
  paid_date: string | null; paid_amount: number | null         // 증빙 없음: 이체로 매칭된 금액
  record_vat: 'taxable' | 'exempt' | 'mixed' | null            // 계산서 발행 기록에 적은 과세 구분 (1304) — 후보는 같은 구분에서만
  other_kind_count: number                                     // 금액 · 날짜는 맞지만 구분이 달라 후보에서 뺀 계산서 수
  // 후보 (2026-11-17): 남은 금액이 need와 같고 발행일이 주문일 −7 ~ +120일인 매출 계산서. foreign = 주문 매출처 · 청구처가 아닌 거래처 명의
  need: number
  vendor_has_billing: boolean
  candidates: InvoiceCandidate[]
  candidate_count: number
}
export interface InvoiceCandidate {
  id: string; issue_date: string; remaining: number; counterparty_name: string | null
  vendor_id: string | null; vendor_name: string; foreign: boolean
  tax_type?: string | null
}

export async function loadInvoiceCheck(admin: SupabaseClient): Promise<{ error: string } | { rows: InvoiceCheckRow[]; latest_invoice: string | null }> {
  // 대상 좁히기: 계산서 발행 기록이 걸린 주문 + 통장 입금이 매칭된 주문
  const recRes = await fetchAllRows<{ id: string; pay_date: string }>((f, t) =>
    admin.from('order_payment_records').select('id, pay_date').eq('method', 'invoice').range(f, t))
  if ('error' in recRes) return { error: /order_payment_record|does not exist|schema cache/i.test(recRes.error) ? '1300 마이그레이션(결제 기록)이 아직 적용되지 않았습니다.' : recRes.error }
  const recDate = new Map(recRes.data.map(r => [r.id, r.pay_date]))
  const recLinks: { record_id: string; order_id: string; amount: number }[] = []
  for (const ch of chunk(Array.from(recDate.keys()), 150)) {
    const { data, error } = await admin.from('order_payment_record_orders').select('record_id, order_id, amount').in('record_id', ch)
    if (error) return { error: error.message }
    recLinks.push(...((data ?? []) as typeof recLinks))
  }
  const bankRes = await fetchAllRows<{ order_id: string; source_id: string; amount: number; paid_date: string }>((f, t) =>
    admin.from('erp_payment_matches').select('order_id, source_id, amount, paid_date').eq('source_type', 'bank').range(f, t))
  if ('error' in bankRes) return { error: bankRes.error }

  const orderIds = Array.from(new Set([...recLinks.map(l => l.order_id), ...bankRes.data.map(m => m.order_id)]))
  type O = { id: string; order_no: string | null; order_date: string; bank_name: string | null; branch_name: string | null; vendor_id: string | null; customer_alias_id: string | null; source: string | null; canceled_at: string | null }
  const orders = new Map<string, O>()
  const invByOrder = new Map<string, number>()
  for (const ch of chunk(orderIds, 150)) {
    const [{ data: os }, { data: inv }] = await Promise.all([
      admin.from('erp_orders').select('id, order_no, order_date, bank_name, branch_name, vendor_id, customer_alias_id, source, canceled_at').in('id', ch),
      admin.from('erp_order_invoices').select('order_id, amount').in('order_id', ch),
    ])
    for (const o of (os ?? []) as O[]) orders.set(o.id, o)
    for (const i of inv ?? []) invByOrder.set(i.order_id as string, (invByOrder.get(i.order_id as string) ?? 0) + Number(i.amount ?? 0))
  }
  const live = (id: string) => { const o = orders.get(id); return !!o && !o.canceled_at && (o.source ?? 'upload') === 'direct' }
  const recv = await loadReceivableMap(admin, orderIds.filter(live))

  // 거래처(별칭 → vendor) · 청구처 이름
  // 계산서 연결 창(lib/order-invoice-match.ts)은 주문을 "별칭의 거래처"로 찾는다 — 여기도 같은 기준이어야 창에 그 주문이 나온다.
  // (2026-11-17 수정: 주문의 vendor_id를 먼저 쓰면 둘이 다른 주문은 창을 열어도 목록에 없었다)
  const aliasIds = Array.from(new Set(Array.from(orders.values()).filter(o => o.customer_alias_id).map(o => o.customer_alias_id as string)))
  const aliasVendor = new Map<string, string>()
  for (const ch of chunk(aliasIds, 150)) {
    const { data } = await admin.from('erp_vendor_aliases').select('id, vendor_id').in('id', ch)
    for (const a of data ?? []) if (a.vendor_id) aliasVendor.set(a.id as string, a.vendor_id as string)
  }
  const vendorOf = (o: O) => (o.customer_alias_id ? aliasVendor.get(o.customer_alias_id) : null) ?? o.vendor_id ?? null
  const vendorIds = Array.from(new Set(Array.from(orders.values()).map(vendorOf).filter(Boolean))) as string[]
  const billingOf = new Map<string, string | null>()
  const vName = new Map<string, string>()
  for (const ch of chunk(vendorIds, 150)) {
    const { data, error } = await admin.from('vendors').select('id, name, billing_vendor_id').in('id', ch)
    if (error) break   // 114 미적용 등 — 청구처 표시만 생략
    for (const v of data ?? []) { vName.set(v.id as string, v.name as string); billingOf.set(v.id as string, (v.billing_vendor_id as string | null) ?? null) }
  }
  const billIds = Array.from(new Set(Array.from(billingOf.values()).filter((x): x is string => !!x && !vName.has(x))))
  for (const ch of chunk(billIds, 150)) {
    const { data } = await admin.from('vendors').select('id, name').in('id', ch)
    for (const v of data ?? []) vName.set(v.id as string, v.name as string)
  }

  // 통장 입금에 연결된 현금영수증 (425 — 없으면 증빙 판정에서 현금영수증은 보지 않는다)
  const txIds = Array.from(new Set(bankRes.data.map(m => m.source_id)))
  const txWithReceipt = new Set<string>()
  for (const ch of chunk(txIds, 150)) {
    const { data, error } = await admin.from('cash_receipt_payments').select('transaction_id').in('transaction_id', ch)
    if (error) break
    for (const r of data ?? []) txWithReceipt.add(r.transaction_id as string)
  }

  const base = (o: O) => {
    const vid = vendorOf(o); const bill = vid ? billingOf.get(vid) : null
    return {
      order_id: o.id, order_no: o.order_no, order_date: o.order_date,
      customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' '), vendor_id: vid,
      billing_name: bill ? vName.get(bill) ?? null : null, net: recv?.get(o.id)?.net_sales ?? 0,
      need: 0, vendor_has_billing: !!bill, candidates: [] as InvoiceCandidate[], candidate_count: 0,
      record_vat: null as InvoiceCheckRow['record_vat'], other_kind_count: 0,
    }
  }
  const rows: InvoiceCheckRow[] = []
  const hasInvoiceRecord = new Set<string>()
  // ① ② 계산서 발행 기록 ↔ 홈택스 계산서
  const recByOrder = new Map<string, { amount: number; date: string }>()
  for (const l of recLinks) {
    if (!live(l.order_id)) continue
    hasInvoiceRecord.add(l.order_id)
    const cur = recByOrder.get(l.order_id) ?? { amount: 0, date: recDate.get(l.record_id) ?? '' }
    cur.amount += Number(l.amount); const d = recDate.get(l.record_id) ?? ''; if (d > cur.date) cur.date = d
    recByOrder.set(l.order_id, cur)
  }
  for (const [orderId, r] of Array.from(recByOrder)) {
    const inv = invByOrder.get(orderId) ?? 0
    if (inv === r.amount) continue
    rows.push({ ...base(orders.get(orderId)!), issue: inv === 0 ? 'no_hometax' : 'amount_diff', record_date: r.date, record_amount: r.amount, invoice_amount: inv, paid_date: null, paid_amount: null })
  }
  // ③ 이체로 받았는데 계산서 · 현금영수증 · 발행 기록이 없음
  const paidByOrder = new Map<string, { amount: number; date: string; receipt: boolean }>()
  for (const m of bankRes.data) {
    if (!live(m.order_id)) continue
    const cur = paidByOrder.get(m.order_id) ?? { amount: 0, date: m.paid_date, receipt: false }
    cur.amount += Number(m.amount); if (m.paid_date > cur.date) cur.date = m.paid_date
    if (txWithReceipt.has(m.source_id)) cur.receipt = true
    paidByOrder.set(m.order_id, cur)
  }
  for (const [orderId, p] of Array.from(paidByOrder)) {
    if (p.receipt || hasInvoiceRecord.has(orderId) || (invByOrder.get(orderId) ?? 0) > 0) continue
    rows.push({ ...base(orders.get(orderId)!), issue: 'no_evidence', record_date: null, record_amount: null, invoice_amount: 0, paid_date: p.date, paid_amount: p.amount })
  }
  rows.sort((a, b) => a.order_date.localeCompare(b.order_date))

  // 후보 계산서 — 금액이 같고 날짜가 가까운 매출 계산서(다른 거래처 명의 포함). 표시만 하고 연결은 사람이 누른다
  for (const r of rows) {
    r.need = r.issue === 'no_hometax' ? (r.record_amount ?? 0) : r.issue === 'no_evidence' ? Math.max(0, r.net - r.invoice_amount) : 0
  }
  const needs = Array.from(new Set(rows.map(r => r.need).filter(n => n > 0)))
  if (needs.length) {
    const minDate = rows.reduce((m, r) => (r.need > 0 && r.order_date < m ? r.order_date : m), kstToday())
    const from = new Date(new Date(minDate).getTime() - 7 * 86400000).toISOString().slice(0, 10)
    const found = await searchSalesInvoices(admin, { amounts: needs, from, limit: 3000 })
    // 같은 구분 안에서만 후보를 찾는다(1304, 2026-11-18). 금액 · 날짜가 맞는 다른 구분 계산서는 건수만 알린다
    const recVat = await loadRecordedInvoiceVat(admin, rows.filter(r => r.need > 0).map(r => r.order_id))
    if (!('error' in found)) {
      for (const r of rows) {
        if (r.need <= 0) continue
        const own = new Set([r.vendor_id, r.vendor_id ? billingOf.get(r.vendor_id) ?? null : null].filter(Boolean) as string[])
        const near = found.data.filter(v => v.remaining === r.need && inInvoiceWindow(v.issue_date, r.order_date))
        const ov = recVat.get(r.order_id)
        r.record_vat = ov ?? null
        r.other_kind_count = near.filter(v => !vatCompatible(ov, v.tax_type)).length
        const cs = near
          .filter(v => vatCompatible(ov, v.tax_type))
          .sort((a, b) => Math.abs(new Date(a.issue_date).getTime() - new Date(r.order_date).getTime()) - Math.abs(new Date(b.issue_date).getTime() - new Date(r.order_date).getTime()))
        r.candidate_count = cs.length
        r.candidates = cs.slice(0, 3).map(v => ({
          id: v.id, issue_date: v.issue_date, remaining: v.remaining, counterparty_name: v.counterparty_name,
          tax_type: v.tax_type ?? null,
          vendor_id: v.vendor_id, vendor_name: v.vendor_name ?? '', foreign: !(v.vendor_id && own.has(v.vendor_id)),
        }))
      }
    }
  }

  const { data: li } = await admin.from('tax_invoices').select('issue_date').eq('direction', 'sales').order('issue_date', { ascending: false }).limit(1)
  return { rows, latest_invoice: (li?.[0]?.issue_date as string | undefined)?.slice(0, 10) ?? null }
}
