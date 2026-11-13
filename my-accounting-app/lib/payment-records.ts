import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { kstToday, type Editor } from './orders-portal'
import { loadReceivableMap } from './orders-portal-list'
import { vendorOfOrder } from './prepay'
import { loadBillingFamily } from './billing'

// ── 결제 기록 (1300, 2026-11-13 사용자 확정 — docs/payment-track.md · 시안 docs/mockups/결제처리_시안.html) ──
// 1차: 영업지원이 주문 상세에서 결제를 기록한다(카드결제 / 계좌이체 / 계산서 발행). 미수는 그대로 — '확인 대기'.
// 2차: 회계 또는 다른 직원이 카드 매출 · 통장 입금 원본과 대조해 확정한다.
//      확정 = 기록의 주문별 금액대로 erp_payment_matches(record_id) 생성 → 표준 미수 뷰가 차감.
// 확인 해제 = record_id 매칭 삭제 → 기록은 '확인 대기'로 복귀(사유 필수, 이력 기록).
// 규칙: 시스템은 후보만 붙인다. 확정은 사람이 누른다. 입력한 본인도 확정할 수 있다(추후 변경 가능 — SELF_CONFIRM_ALLOWED).
// 카드번호 전체 · 유효기간은 받지 않는다 — 승인번호 + 카드 뒤 4자리.

export const SELF_CONFIRM_ALLOWED = true
export const PENDING_ALERT_DAYS = 3      // 확인 대기 경과 알림 기준(원본 최신일 기준, 카드 · 이체)

export type PayMethod = 'card' | 'transfer' | 'invoice'
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { card: '카드결제', transfer: '계좌이체', invoice: '계산서 발행' }

const won = (n: number) => n.toLocaleString('ko-KR')
const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const toInt = (v: unknown) => Math.round(Number(String(v ?? '').replace(/,/g, '')))

export const MIGRATION_1300_MSG = '1300 마이그레이션(결제 기록)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missing = (msg: string | undefined) => !!msg && /order_payment_record|record_id|schema cache|does not exist/i.test(msg)
const errMsg = (msg: string | undefined) => (missing(msg) ? MIGRATION_1300_MSG : (msg ?? '알 수 없는 오류'))

export interface RecordInput {
  method: PayMethod
  pay_date: string
  amount: number
  approval_number: string | null
  card_last4: string | null
  depositor_name: string | null
  due_date: string | null
  memo: string | null
  allocations: { order_id: string; amount: number }[]
}

export function validateRecordInput(raw: unknown): RecordInput | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>
  const method = b.method as PayMethod
  if (!['card', 'transfer', 'invoice'].includes(method)) return { error: '결제 수단을 고르세요.' }
  if (!isDate(b.pay_date)) return { error: method === 'invoice' ? '발행일을 입력하세요.' : '결제일을 입력하세요.' }
  if (b.pay_date > addDays(kstToday(), 1)) return { error: '결제일이 미래입니다. 실제 결제(발행)한 날짜를 입력하세요.' }
  const amount = toInt(b.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { error: '결제 금액을 입력하세요.' }
  const text = (v: unknown, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null }

  let approval: string | null = null, last4: string | null = null, depositor: string | null = null, due: string | null = null
  if (method === 'card') {
    approval = text(b.approval_number, 30)
    if (!approval) return { error: '승인번호를 입력하세요. (2차 대조에 쓰입니다)' }
    const digits = String(b.card_last4 ?? '').replace(/\D/g, '')
    // 카드번호 전체는 받지 않는다 — 4자리를 넘겨 붙여넣으면 저장하지 않고 돌려보낸다
    if (digits && digits.length !== 4) return { error: '카드번호는 뒤 4자리만 입력하세요. (전체 번호는 저장하지 않습니다)' }
    last4 = digits || null
  } else if (method === 'transfer') {
    depositor = text(b.depositor_name, 40)
  } else {
    if (b.due_date) {
      if (!isDate(b.due_date)) return { error: '입금 예정일 형식이 올바르지 않습니다.' }
      due = b.due_date
    }
  }

  const merged = new Map<string, number>()
  for (const a of (Array.isArray(b.allocations) ? b.allocations : []) as Record<string, unknown>[]) {
    const id = String(a?.order_id ?? ''); const amt = toInt(a?.amount)
    if (!id || !Number.isFinite(amt) || amt <= 0) continue
    merged.set(id, (merged.get(id) ?? 0) + amt)
  }
  const allocations = Array.from(merged, ([order_id, amt]) => ({ order_id, amount: amt }))
  if (!allocations.length) return { error: '주문별 금액을 입력하세요.' }
  const sum = allocations.reduce((s, a) => s + a.amount, 0)
  if (sum !== amount) return { error: `주문별 금액 합계(${won(sum)}원)가 결제 금액(${won(amount)}원)과 다릅니다.` }
  return { method, pay_date: b.pay_date, amount, approval_number: approval, card_last4: last4, depositor_name: depositor, due_date: due, memo: text(b.memo, 300), allocations }
}

async function writeLog(admin: SupabaseClient, recordId: string, action: string, editor: Editor, detail: string | null) {
  await admin.from('order_payment_record_logs').insert({
    record_id: recordId, action, employee_id: editor.employeeId, employee_name: editor.employeeName, detail,
  })
}

const summaryOf = (i: { method: PayMethod; pay_date: string; amount: number }, orderCount: number) =>
  `${PAY_METHOD_LABEL[i.method]} ${i.pay_date} ${won(i.amount)}원${orderCount > 1 ? ` · 주문 ${orderCount}건` : ''}`

// ── 주문별 미결제 금액 = 표준 미수 − 확인 대기 기록 합 ─────────────────────
export interface UnpaidInfo { outstanding: number; pending: number; unpaid: number }

export async function unpaidOfOrders(admin: SupabaseClient, orderIds: string[], excludeRecordId?: string | null): Promise<Map<string, UnpaidInfo> | { error: string }> {
  const out = new Map<string, UnpaidInfo>()
  if (!orderIds.length) return out
  const recv = await loadReceivableMap(admin, orderIds)
  if (!recv) return { error: '미수 계산 뷰(v_erp_order_receivable)를 읽지 못했습니다.' }
  const pending = new Map<string, number>()
  for (const ch of chunk(orderIds, 150)) {
    const { data, error } = await admin.from('order_payment_record_orders')
      .select('order_id, amount, record_id').in('order_id', ch)
    if (error) return { error: errMsg(error.message) }
    // 확인 대기 기록만 (임베드 필터 대신 두 번 조회 — 건수가 적다)
    const recIds = Array.from(new Set((data ?? []).map(r => r.record_id as string)))
    const open = new Set<string>()
    for (const rc of chunk(recIds, 150)) {
      const { data: rs, error: re } = await admin.from('order_payment_records').select('id').in('id', rc).is('confirmed_at', null)
      if (re) return { error: errMsg(re.message) }
      for (const x of rs ?? []) open.add(x.id as string)
    }
    for (const r of data ?? []) {
      if (!open.has(r.record_id as string)) continue
      if (excludeRecordId && r.record_id === excludeRecordId) continue
      pending.set(r.order_id as string, (pending.get(r.order_id as string) ?? 0) + Number(r.amount ?? 0))
    }
  }
  for (const id of orderIds) {
    const o = recv.get(id)?.outstanding ?? 0
    const p = pending.get(id) ?? 0
    out.set(id, { outstanding: o, pending: p, unpaid: Math.max(0, o - p) })
  }
  return out
}

type OrderLite = { id: string; order_no: string | null; order_date: string; bank_name: string | null; branch_name: string | null; source: string | null; canceled_at: string | null; vendor_id: string | null; customer_alias_id: string | null }
const ORDER_COLS = 'id, order_no, order_date, bank_name, branch_name, source, canceled_at, vendor_id, customer_alias_id'

async function loadOrders(admin: SupabaseClient, ids: string[]): Promise<Map<string, OrderLite>> {
  const out = new Map<string, OrderLite>()
  for (const ch of chunk(Array.from(new Set(ids)), 150)) {
    const { data } = await admin.from('erp_orders').select(ORDER_COLS).in('id', ch)
    for (const o of (data ?? []) as OrderLite[]) out.set(o.id, o)
  }
  return out
}

async function checkAllocations(admin: SupabaseClient, input: RecordInput, excludeRecordId: string | null): Promise<{ error: string } | { orders: Map<string, OrderLite> }> {
  const ids = input.allocations.map(a => a.order_id)
  const orders = await loadOrders(admin, ids)
  for (const a of input.allocations) {
    const o = orders.get(a.order_id)
    if (!o) return { error: '주문을 찾을 수 없습니다.' }
    if (o.canceled_at) return { error: `취소된 주문(${o.order_no ?? ''})에는 결제를 기록할 수 없습니다.` }
  }
  const unpaid = await unpaidOfOrders(admin, ids, excludeRecordId)
  if ('error' in unpaid) return unpaid
  for (const a of input.allocations) {
    const u = unpaid.get(a.order_id)?.unpaid ?? 0
    if (a.amount > u) {
      const no = orders.get(a.order_id)?.order_no ?? ''
      return { error: `주문 ${no}의 미결제 금액은 ${won(u)}원입니다. ${won(a.amount)}원은 기록할 수 없습니다. (이미 수금됐거나 다른 결제 기록이 있습니다)` }
    }
  }
  return { orders }
}

export async function createRecord(admin: SupabaseClient, baseOrderId: string, input: RecordInput, editor: Editor): Promise<{ error: string } | { ok: true; id: string }> {
  if (!input.allocations.some(a => a.order_id === baseOrderId)) return { error: '이 주문의 금액이 빠져 있습니다.' }
  const chk = await checkAllocations(admin, input, null)
  if ('error' in chk) return chk
  const vendorId = await vendorOfOrder(admin, chk.orders.get(baseOrderId)!)
  const { data: rec, error } = await admin.from('order_payment_records').insert({
    method: input.method, pay_date: input.pay_date, amount: input.amount,
    approval_number: input.approval_number, card_last4: input.card_last4, depositor_name: input.depositor_name,
    due_date: input.due_date, memo: input.memo, vendor_id: vendorId,
    created_by: editor.employeeId, created_by_name: editor.employeeName,
  }).select('id').single()
  if (error || !rec) return { error: errMsg(error?.message) }
  const { error: ae } = await admin.from('order_payment_record_orders')
    .insert(input.allocations.map(a => ({ record_id: rec.id, order_id: a.order_id, amount: a.amount })))
  if (ae) {
    await admin.from('order_payment_records').delete().eq('id', rec.id)   // 반쪽 기록 방지
    return { error: errMsg(ae.message) }
  }
  await writeLog(admin, rec.id as string, 'create', editor, summaryOf(input, input.allocations.length))
  return { ok: true, id: rec.id as string }
}

async function loadPendingRecord(admin: SupabaseClient, recordId: string): Promise<{ error: string } | { rec: { id: string; method: PayMethod; pay_date: string; amount: number } }> {
  const { data, error } = await admin.from('order_payment_records')
    .select('id, method, pay_date, amount, confirmed_at').eq('id', recordId).maybeSingle()
  if (error) return { error: errMsg(error.message) }
  if (!data) return { error: '결제 기록을 찾을 수 없습니다.' }
  if (data.confirmed_at) return { error: '결제 확인된 기록은 잠겨 있습니다. 고치려면 결제 확인 화면에서 확인 해제를 먼저 해야 합니다.' }
  return { rec: data as { id: string; method: PayMethod; pay_date: string; amount: number } }
}

export async function updateRecord(admin: SupabaseClient, recordId: string, input: RecordInput, editor: Editor): Promise<{ error: string } | { ok: true }> {
  const cur = await loadPendingRecord(admin, recordId)
  if ('error' in cur) return cur
  const chk = await checkAllocations(admin, input, recordId)
  if ('error' in chk) return chk
  const { error } = await admin.from('order_payment_records').update({
    method: input.method, pay_date: input.pay_date, amount: input.amount,
    approval_number: input.approval_number, card_last4: input.card_last4, depositor_name: input.depositor_name,
    due_date: input.due_date, memo: input.memo, updated_at: new Date().toISOString(),
  }).eq('id', recordId).is('confirmed_at', null)
  if (error) return { error: errMsg(error.message) }
  await admin.from('order_payment_record_orders').delete().eq('record_id', recordId)
  const { error: ae } = await admin.from('order_payment_record_orders')
    .insert(input.allocations.map(a => ({ record_id: recordId, order_id: a.order_id, amount: a.amount })))
  if (ae) return { error: errMsg(ae.message) }
  await writeLog(admin, recordId, 'update', editor, `${summaryOf(cur.rec, 0)} → ${summaryOf(input, input.allocations.length)}`)
  return { ok: true }
}

export async function deleteRecord(admin: SupabaseClient, recordId: string, editor: Editor): Promise<{ error: string } | { ok: true }> {
  const cur = await loadPendingRecord(admin, recordId)
  if ('error' in cur) return cur
  const { error } = await admin.from('order_payment_records').delete().eq('id', recordId).is('confirmed_at', null)
  if (error) return { error: errMsg(error.message) }
  await writeLog(admin, recordId, 'delete', editor, summaryOf(cur.rec, 0))
  return { ok: true }
}

// ── 조회 ────────────────────────────────────────────────────────────────
export interface PayRecordView {
  id: string
  method: PayMethod
  pay_date: string
  amount: number
  approval_number: string | null
  card_last4: string | null
  depositor_name: string | null
  due_date: string | null
  memo: string | null
  vendor_id: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  confirmed_by_name: string | null
  confirmed_at: string | null
  orders: { order_id: string; order_no: string | null; amount: number }[]
}
const REC_COLS = 'id, method, pay_date, amount, approval_number, card_last4, depositor_name, due_date, memo, vendor_id, created_by, created_by_name, created_at, confirmed_by_name, confirmed_at'

async function attachOrders(admin: SupabaseClient, recs: Record<string, unknown>[]): Promise<PayRecordView[]> {
  const ids = recs.map(r => r.id as string)
  const links: { record_id: string; order_id: string; amount: number }[] = []
  for (const ch of chunk(ids, 150)) {
    const { data } = await admin.from('order_payment_record_orders').select('record_id, order_id, amount').in('record_id', ch)
    links.push(...((data ?? []) as typeof links))
  }
  const orders = await loadOrders(admin, links.map(l => l.order_id))
  const by = new Map<string, PayRecordView['orders']>()
  for (const l of links) {
    const list = by.get(l.record_id) ?? []
    list.push({ order_id: l.order_id, order_no: orders.get(l.order_id)?.order_no ?? null, amount: Number(l.amount) })
    by.set(l.record_id, list)
  }
  return recs.map(r => ({ ...(r as unknown as PayRecordView), amount: Number(r.amount), orders: (by.get(r.id as string) ?? []).sort((a, b) => (a.order_no ?? '').localeCompare(b.order_no ?? '')) }))
}

// 주문 상세용: 이 주문이 들어 있는 결제 기록 (1300 미적용이면 available=false)
export async function loadRecordsOfOrder(admin: SupabaseClient, orderId: string): Promise<{ available: boolean; records: PayRecordView[] }> {
  const { data: links, error } = await admin.from('order_payment_record_orders').select('record_id').eq('order_id', orderId)
  if (error) return { available: false, records: [] }
  const ids = (links ?? []).map(l => l.record_id as string)
  if (!ids.length) return { available: true, records: [] }
  const { data, error: re } = await admin.from('order_payment_records').select(REC_COLS).in('id', ids).order('pay_date').order('created_at')
  if (re) return { available: false, records: [] }
  return { available: true, records: await attachOrders(admin, (data ?? []) as Record<string, unknown>[]) }
}

// 같은 결제로 함께 처리할 수 있는 주문: 같은 매출처 + 청구처 가족의 미결제 direct 주문
export interface CandidateOrder { order_id: string; order_no: string | null; order_date: string; customer_name: string; unpaid: number }

export async function loadCandidateOrders(admin: SupabaseClient, orderId: string, excludeRecordId?: string | null): Promise<{ error: string } | { data: CandidateOrder[] }> {
  const base = (await loadOrders(admin, [orderId])).get(orderId)
  if (!base) return { error: '주문을 찾을 수 없습니다.' }
  const vendorId = await vendorOfOrder(admin, base)
  let rows: OrderLite[] = [base]
  if (vendorId) {
    const fam = await loadBillingFamily(admin, vendorId)
    const { data: aliases } = await admin.from('erp_vendor_aliases').select('id').eq('alias_type', 'customer').in('vendor_id', fam.members.slice(0, 150))
    const aliasIds = (aliases ?? []).map(a => a.id as string)
    const since = addDays(kstToday(), -365)
    const seen = new Map<string, OrderLite>([[base.id, base]])
    for (const ch of chunk(aliasIds, 100)) {
      const { data } = await admin.from('erp_orders').select(ORDER_COLS)
        .in('customer_alias_id', ch).is('canceled_at', null).gte('order_date', since)
        .order('order_date', { ascending: false }).limit(500)
      for (const o of (data ?? []) as OrderLite[]) seen.set(o.id, o)
    }
    rows = Array.from(seen.values())
  }
  const unpaid = await unpaidOfOrders(admin, rows.map(r => r.id), excludeRecordId)
  if ('error' in unpaid) return unpaid
  const data = rows
    .map(o => ({ order_id: o.id, order_no: o.order_no, order_date: o.order_date, customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' '), unpaid: unpaid.get(o.id)?.unpaid ?? 0 }))
    .filter(o => o.unpaid > 0 || o.order_id === orderId)
    .sort((a, b) => (a.order_id === orderId ? -1 : b.order_id === orderId ? 1 : b.order_date.localeCompare(a.order_date)))
  return { data: data.slice(0, 100) }
}

// ── 2차: 결제 확인 대기열 ─────────────────────────────────────────────────
export interface SourceCandidate {
  source_type: 'bank' | 'card'
  source_id: string
  tx_date: string
  label: string
  amount: number          // 통장 입금액 / 카드 순액(승인 − 취소)
  remaining: number       // 아직 주문에 배분되지 않은 금액
  strength: 'strong' | 'weak' | 'mismatch'
  reason: string
}
export interface QueueRow extends PayRecordView {
  vendor_name: string | null
  state: 'pending' | 'confirmed'
  candidates: SourceCandidate[]
  flag: 'ready' | 'mismatch' | 'overdue' | 'waiting' | null
  wait_days: number
  invoice_linked: number | null      // 계산서 발행 기록: 주문에 연결된 홈택스 계산서 금액 합 (없으면 0)
  matched: { source_type: string; label: string; paid_date: string; amount: number }[]
  mine: boolean
}

async function allocatedBySource(admin: SupabaseClient, ids: string[]) {
  const out = new Map<string, number>()
  for (const ch of chunk(Array.from(new Set(ids)), 150)) {
    const { data } = await admin.from('erp_payment_matches').select('source_type, source_id, amount').in('source_id', ch)
    for (const m of data ?? []) out.set(`${m.source_type}:${m.source_id}`, (out.get(`${m.source_type}:${m.source_id}`) ?? 0) + Number(m.amount ?? 0))
  }
  return out
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s|\(주\)|주식회사|㈜/g, '').toLowerCase()
const nameHit = (a: string | null | undefined, b: string | null | undefined) => {
  const x = norm(a), y = norm(b)
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))
}
const dayDiff = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)

export async function loadConfirmQueue(admin: SupabaseClient, opts: { state: 'pending' | 'confirmed'; meId: string | null }): Promise<
  { error: string } | { rows: QueueRow[]; latest: { card: string | null; bank: string | null } }
> {
  let q = admin.from('order_payment_records').select(REC_COLS)
  q = opts.state === 'pending'
    ? q.is('confirmed_at', null).order('pay_date', { ascending: true }).limit(500)
    : q.not('confirmed_at', 'is', null).order('confirmed_at', { ascending: false }).limit(200)
  const { data, error } = await q
  if (error) return { error: errMsg(error.message) }
  const recs = await attachOrders(admin, (data ?? []) as Record<string, unknown>[])

  const [{ data: lc }, { data: lb }] = await Promise.all([
    admin.from('card_sales').select('tx_date').order('tx_date', { ascending: false }).limit(1),
    admin.from('transactions').select('tx_date').gt('amount_in', 0).order('tx_date', { ascending: false }).limit(1),
  ])
  const latest = { card: (lc?.[0]?.tx_date as string | undefined) ?? null, bank: (lb?.[0]?.tx_date as string | undefined) ?? null }

  const vendorIds = Array.from(new Set(recs.map(r => r.vendor_id).filter(Boolean))) as string[]
  const vendorName = new Map<string, string>()
  for (const ch of chunk(vendorIds, 150)) {
    const { data: vs } = await admin.from('vendors').select('id, name').in('id', ch)
    for (const v of vs ?? []) vendorName.set(v.id as string, v.name as string)
  }

  // 계산서 발행 기록 — 주문에 연결된 홈택스 계산서 금액 (연결 자체는 계산서 연결 화면이 원천)
  const invOrderIds = Array.from(new Set(recs.filter(r => r.method === 'invoice').flatMap(r => r.orders.map(o => o.order_id))))
  const invByOrder = new Map<string, number>()
  for (const ch of chunk(invOrderIds, 150)) {
    const { data: inv } = await admin.from('erp_order_invoices').select('order_id, amount').in('order_id', ch)
    for (const i of inv ?? []) invByOrder.set(i.order_id as string, (invByOrder.get(i.order_id as string) ?? 0) + Number(i.amount ?? 0))
  }

  const today = kstToday()
  const rows: QueueRow[] = recs.map(r => ({
    ...r, vendor_name: r.vendor_id ? vendorName.get(r.vendor_id) ?? null : null,
    state: opts.state, candidates: [], flag: null, wait_days: Math.max(0, dayDiff(today, r.pay_date)),
    invoice_linked: r.method === 'invoice' ? r.orders.reduce((s, o) => s + (invByOrder.get(o.order_id) ?? 0), 0) : null,
    matched: [], mine: !!opts.meId && r.created_by === opts.meId,
  }))

  if (opts.state === 'confirmed') {
    // 확정된 기록에 붙은 원본
    const ids = rows.map(r => r.id)
    const ms: { record_id: string; source_type: string; source_id: string; amount: number; paid_date: string }[] = []
    for (const ch of chunk(ids, 150)) {
      const { data: m, error: me } = await admin.from('erp_payment_matches').select('record_id, source_type, source_id, amount, paid_date').in('record_id', ch)
      if (me) return { error: errMsg(me.message) }
      ms.push(...((m ?? []) as typeof ms))
    }
    const label = new Map<string, string>()
    const bankIds = Array.from(new Set(ms.filter(m => m.source_type === 'bank').map(m => m.source_id)))
    const cardIds = Array.from(new Set(ms.filter(m => m.source_type === 'card').map(m => m.source_id)))
    for (const ch of chunk(bankIds, 150)) {
      const { data: t } = await admin.from('transactions').select('id, counterparty_name, description').in('id', ch)
      for (const x of t ?? []) label.set(`bank:${x.id}`, `통장 ${String(x.counterparty_name || x.description || '').slice(0, 20)}`.trim())
    }
    for (const ch of chunk(cardIds, 150)) {
      const { data: c } = await admin.from('card_sales').select('id, approval_number, card_number').in('id', ch)
      for (const x of c ?? []) label.set(`card:${x.id}`, `카드 매출 승인 ${x.approval_number ?? ''}`.trim())
    }
    const byRec = new Map<string, Map<string, QueueRow['matched'][number]>>()
    for (const m of ms) {
      const k = `${m.source_type}:${m.source_id}`
      const g = byRec.get(m.record_id) ?? new Map()
      const cur = g.get(k) ?? { source_type: m.source_type, label: label.get(k) ?? m.source_type, paid_date: m.paid_date, amount: 0 }
      cur.amount += Number(m.amount)
      g.set(k, cur); byRec.set(m.record_id, g)
    }
    for (const r of rows) r.matched = Array.from(byRec.get(r.id)?.values() ?? [])
    return { rows, latest }
  }

  // ── 후보 찾기 ──
  // 카드: 승인번호 일치(강) → 금액 다르면 불일치. 승인번호가 없으면 금액 · 날짜 ±3일 · 뒤 4자리(약)
  type Cs = { id: string; tx_date: string; approval_number: string; card_number: string | null; acquirer: string | null; amount: number | null; transaction_type: string }
  const cardRecs = rows.filter(r => r.method === 'card')
  const approvals = Array.from(new Set(cardRecs.map(r => r.approval_number).filter(Boolean))) as string[]
  const csByApproval = new Map<string, Cs[]>()
  for (const ch of chunk(approvals, 100)) {
    const { data: cs } = await admin.from('card_sales').select('id, tx_date, approval_number, card_number, acquirer, amount, transaction_type').in('approval_number', ch)
    for (const c of (cs ?? []) as Cs[]) { const l = csByApproval.get(c.approval_number) ?? []; l.push(c); csByApproval.set(c.approval_number, l) }
  }
  // 승인번호로 못 찾은 카드 기록 → 금액으로 보조 검색
  const fallbackAmounts = Array.from(new Set(cardRecs.filter(r => !(csByApproval.get(r.approval_number ?? '') ?? []).some(c => c.transaction_type === 'approval')).map(r => r.amount)))
  const csByAmount = new Map<number, Cs[]>()
  if (fallbackAmounts.length) {
    const minDate = addDays(cardRecs.reduce((m, r) => (r.pay_date < m ? r.pay_date : m), today), -3)
    for (const ch of chunk(fallbackAmounts, 100)) {
      const { data: cs } = await admin.from('card_sales').select('id, tx_date, approval_number, card_number, acquirer, amount, transaction_type')
        .eq('transaction_type', 'approval').in('amount', ch).gte('tx_date', minDate).limit(1000)
      for (const c of (cs ?? []) as Cs[]) { const l = csByAmount.get(Number(c.amount)) ?? []; l.push(c); csByAmount.set(Number(c.amount), l) }
    }
    // 보조 후보의 취소 행 (순액 계산)
    const extraNos = Array.from(new Set(Array.from(csByAmount.values()).flat().map(c => c.approval_number))).filter(n => !csByApproval.has(n))
    for (const ch of chunk(extraNos, 100)) {
      const { data: cs } = await admin.from('card_sales').select('id, tx_date, approval_number, card_number, acquirer, amount, transaction_type').in('approval_number', ch)
      for (const c of (cs ?? []) as Cs[]) { const l = csByApproval.get(c.approval_number) ?? []; l.push(c); csByApproval.set(c.approval_number, l) }
    }
  }
  const cardNet = (no: string) => {
    const list = csByApproval.get(no) ?? []
    const appr = list.find(c => c.transaction_type === 'approval')
    if (!appr) return null
    const cancel = list.filter(c => c.transaction_type === 'cancel').reduce((s, c) => s + Math.abs(Number(c.amount ?? 0)), 0)
    return { appr, net: Math.abs(Number(appr.amount ?? 0)) - cancel }
  }

  // 통장: 금액 일치 + 날짜 범위(이체: 결제일 −3 ~ +14일 / 계산서: 발행일 ~ +120일)
  type Tx = { id: string; tx_date: string; counterparty_name: string | null; description: string | null; vendor_id: string | null; amount_in: number | null }
  const bankRecs = rows.filter(r => r.method !== 'card')
  const txByAmount = new Map<number, Tx[]>()
  if (bankRecs.length) {
    const minDate = addDays(bankRecs.reduce((m, r) => (r.pay_date < m ? r.pay_date : m), today), -3)
    for (const ch of chunk(Array.from(new Set(bankRecs.map(r => r.amount))), 100)) {
      const res = await fetchAllRows<Tx>((f, t) => admin.from('transactions')
        .select('id, tx_date, counterparty_name, description, vendor_id, amount_in')
        .in('amount_in', ch).gte('tx_date', minDate).is('transfer_pair_id', null).order('tx_date').range(f, t))
      if ('error' in res) return { error: res.error }
      for (const t of res.data) { const l = txByAmount.get(Number(t.amount_in)) ?? []; l.push(t); txByAmount.set(Number(t.amount_in), l) }
    }
  }

  const alloc = await allocatedBySource(admin, [
    ...Array.from(csByApproval.values()).flat().filter(c => c.transaction_type === 'approval').map(c => c.id),
    ...Array.from(txByAmount.values()).flat().map(t => t.id),
  ])

  for (const r of rows) {
    if (r.method === 'card') {
      const hit = r.approval_number ? cardNet(r.approval_number) : null
      if (hit) {
        const remaining = hit.net - (alloc.get(`card:${hit.appr.id}`) ?? 0)
        const tail = String(hit.appr.card_number ?? '').replace(/\D/g, '').slice(-4)
        const same = hit.net === r.amount && remaining >= r.amount
        const parts = ['승인번호 일치']
        if (hit.net === r.amount) parts.push('금액 일치'); else parts.push(`금액 ${won(Math.abs(hit.net - r.amount))}원 다름`)
        if (r.card_last4 && tail) parts.push(r.card_last4 === tail ? '카드 일치' : `카드 뒤 4자리 다름(${tail})`)
        if (hit.net === r.amount && remaining < r.amount) parts.push(`이미 다른 주문에 ${won(hit.net - remaining)}원 배분됨`)
        r.candidates.push({
          source_type: 'card', source_id: hit.appr.id, tx_date: hit.appr.tx_date, label: `카드 매출 ${hit.appr.acquirer ?? ''}`.trim(),
          amount: hit.net, remaining, strength: same ? 'strong' : 'mismatch', reason: parts.join(' · '),
        })
      } else {
        for (const c of csByAmount.get(r.amount) ?? []) {
          if (Math.abs(dayDiff(c.tx_date, r.pay_date)) > 3) continue
          const net = cardNet(c.approval_number)?.net ?? Math.abs(Number(c.amount ?? 0))
          const remaining = net - (alloc.get(`card:${c.id}`) ?? 0)
          if (net !== r.amount || remaining < r.amount) continue
          const tail = String(c.card_number ?? '').replace(/\D/g, '').slice(-4)
          if (r.card_last4 && tail && r.card_last4 !== tail) continue
          r.candidates.push({
            source_type: 'card', source_id: c.id, tx_date: c.tx_date, label: `카드 매출 ${c.acquirer ?? ''}`.trim(),
            amount: net, remaining, strength: 'weak',
            reason: `승인번호 다름(원본 ${c.approval_number}) · 금액 일치${r.card_last4 && tail ? ' · 카드 일치' : ''}`,
          })
        }
      }
    } else {
      const from = r.method === 'invoice' ? r.pay_date : addDays(r.pay_date, -3)
      const to = addDays(r.pay_date, r.method === 'invoice' ? 120 : 14)
      for (const t of txByAmount.get(r.amount) ?? []) {
        if (t.tx_date < from || t.tx_date > to) continue
        const remaining = Number(t.amount_in ?? 0) - (alloc.get(`bank:${t.id}`) ?? 0)
        if (remaining < r.amount) continue
        const who = (t.counterparty_name || t.description || '').trim()
        const byName = nameHit(who, r.depositor_name) || nameHit(who, r.vendor_name)
        const byVendor = !!r.vendor_id && t.vendor_id === r.vendor_id
        const parts = ['금액 일치']
        if (byVendor) parts.push('거래처 일치')
        if (byName) parts.push('입금자 비슷')
        const dd = dayDiff(t.tx_date, r.pay_date)
        if (r.method === 'transfer') parts.push(dd === 0 ? '같은 날' : `${Math.abs(dd)}일 ${dd > 0 ? '뒤' : '앞'}`)
        r.candidates.push({
          source_type: 'bank', source_id: t.id, tx_date: t.tx_date, label: `통장 ${who.slice(0, 20)}`.trim(),
          amount: Number(t.amount_in ?? 0), remaining, strength: byVendor || byName ? 'strong' : 'weak', reason: parts.join(' · '),
        })
      }
      r.candidates.sort((a, b) => (a.strength === b.strength ? Math.abs(dayDiff(a.tx_date, r.pay_date)) - Math.abs(dayDiff(b.tx_date, r.pay_date)) : a.strength === 'strong' ? -1 : 1))
      r.candidates = r.candidates.slice(0, 5)
    }

    // 표시용 판정
    if (r.candidates.some(c => c.strength === 'mismatch')) r.flag = 'mismatch'
    else if (r.candidates.length) r.flag = 'ready'
    else if (r.method === 'invoice') r.flag = r.due_date && r.due_date < today ? 'overdue' : 'waiting'
    else {
      // 원본이 결제일 + 기준일 이후까지 올라와 있는데도 후보가 없으면 경과
      const src = r.method === 'card' ? latest.card : latest.bank
      r.flag = src && src >= addDays(r.pay_date, PENDING_ALERT_DAYS) ? 'overdue' : 'waiting'
    }
  }
  return { rows, latest }
}

// ── 2차: 확정 · 확인 해제 ─────────────────────────────────────────────────
export interface ConfirmSource { source_type: 'bank' | 'card'; source_id: string; amount: number }

export async function confirmRecord(admin: SupabaseClient, recordId: string, rawSources: ConfirmSource[], editor: Editor): Promise<{ error: string } | { ok: true; inserted: number }> {
  const { data: rec, error } = await admin.from('order_payment_records')
    .select('id, method, pay_date, amount, vendor_id, created_by, confirmed_at').eq('id', recordId).maybeSingle()
  if (error) return { error: errMsg(error.message) }
  if (!rec) return { error: '결제 기록을 찾을 수 없습니다.' }
  if (rec.confirmed_at) return { error: '이미 확인된 기록입니다.' }
  if (!SELF_CONFIRM_ALLOWED && rec.created_by && rec.created_by === editor.employeeId) return { error: '입력한 본인은 확정할 수 없습니다. 다른 직원에게 요청하세요.' }
  const { count } = await admin.from('erp_payment_matches').select('id', { count: 'exact', head: true }).eq('record_id', recordId)
  if ((count ?? 0) > 0) return { error: '이 기록에 이미 수금 매칭이 붙어 있습니다. 확인 해제 후 다시 시도하세요.' }

  const merged = new Map<string, ConfirmSource>()
  for (const s of rawSources ?? []) {
    if ((s?.source_type !== 'bank' && s?.source_type !== 'card') || !s.source_id) continue
    const amt = toInt(s.amount); if (!Number.isFinite(amt) || amt <= 0) continue
    const k = `${s.source_type}:${s.source_id}`
    merged.set(k, { source_type: s.source_type, source_id: s.source_id, amount: (merged.get(k)?.amount ?? 0) + amt })
  }
  const sources = Array.from(merged.values())
  if (!sources.length) return { error: '대조할 입금 · 카드 매출을 고르세요.' }
  const total = sources.reduce((s, x) => s + x.amount, 0)
  const amount = Number(rec.amount)
  if (total !== amount) return { error: `고른 원본 합계(${won(total)}원)가 기록 금액(${won(amount)}원)과 다릅니다. 금액이 다르면 입력자에게 기록 수정을 요청하세요.` }

  // 원본 잔액 · 결제일
  const alloc = await allocatedBySource(admin, sources.map(s => s.source_id))
  const paidDate = new Map<string, string>()
  const cardApproval = new Map<string, { no: string; vendor_id: string | null }>()
  for (const s of sources) {
    const k = `${s.source_type}:${s.source_id}`
    let srcAmount = 0
    if (s.source_type === 'bank') {
      const { data: t } = await admin.from('transactions').select('id, tx_date, amount_in').eq('id', s.source_id).maybeSingle()
      if (!t) return { error: '통장 입금 내역을 찾을 수 없습니다.' }
      srcAmount = Number(t.amount_in ?? 0); paidDate.set(k, String(t.tx_date).slice(0, 10))
    } else {
      const { data: c } = await admin.from('card_sales').select('id, tx_date, amount, approval_number, vendor_id, transaction_type').eq('id', s.source_id).maybeSingle()
      if (!c || c.transaction_type !== 'approval') return { error: '카드 매출 승인 내역을 찾을 수 없습니다.' }
      const { data: cancels } = await admin.from('card_sales').select('amount').eq('transaction_type', 'cancel').eq('approval_number', c.approval_number as string)
      srcAmount = Math.abs(Number(c.amount ?? 0)) - (cancels ?? []).reduce((x, y) => x + Math.abs(Number(y.amount ?? 0)), 0)
      paidDate.set(k, String(c.tx_date).slice(0, 10))
      cardApproval.set(s.source_id, { no: c.approval_number as string, vendor_id: (c.vendor_id as string | null) ?? null })
    }
    const remaining = srcAmount - (alloc.get(k) ?? 0)
    if (s.amount > remaining) return { error: `원본 잔액(${won(remaining)}원)이 부족합니다. 이미 다른 주문에 배분된 입금 · 결제입니다.` }
  }

  // 주문별 금액 · 주문 미수 검증
  const { data: links, error: le } = await admin.from('order_payment_record_orders').select('order_id, amount').eq('record_id', recordId)
  if (le) return { error: errMsg(le.message) }
  const allocs = ((links ?? []) as { order_id: string; amount: number }[]).map(l => ({ order_id: l.order_id, amount: Number(l.amount) }))
  if (!allocs.length) return { error: '기록에 주문이 없습니다.' }
  const orders = await loadOrders(admin, allocs.map(a => a.order_id))
  const recv = await loadReceivableMap(admin, allocs.map(a => a.order_id))
  if (!recv) return { error: '미수 계산 뷰(v_erp_order_receivable)를 읽지 못했습니다.' }
  for (const a of allocs) {
    const o = orders.get(a.order_id)
    if (!o || o.canceled_at) return { error: `취소되었거나 없는 주문(${o?.order_no ?? ''})이 들어 있습니다. 입력자에게 기록 수정을 요청하세요.` }
    const out = recv.get(a.order_id)?.outstanding ?? 0
    if (a.amount > out) return { error: `주문 ${o.order_no ?? ''}의 미수(${won(out)}원)가 기록 금액(${won(a.amount)}원)보다 적습니다. 이미 다른 결제로 수금된 주문입니다.` }
  }

  // 원본 → 주문으로 순서대로 채운다 (원본 1건이 보통. 여러 건이면 물 붓듯 배분)
  const rowsToInsert: Record<string, unknown>[] = []
  const left = allocs.map(a => ({ ...a }))
  for (const s of sources) {
    let rest = s.amount
    for (const a of left) {
      if (rest <= 0) break
      if (a.amount <= 0) continue
      const use = Math.min(rest, a.amount)
      rowsToInsert.push({
        order_id: a.order_id, source_type: s.source_type, source_id: s.source_id, amount: use,
        paid_date: paidDate.get(`${s.source_type}:${s.source_id}`), matched_by: 'manual', record_id: recordId,
        memo: ['결제 확인', editor.employeeName].filter(Boolean).join(' · '),
      })
      a.amount -= use; rest -= use
    }
  }
  const { error: ie } = await admin.from('erp_payment_matches').insert(rowsToInsert)
  if (ie) return { error: errMsg(ie.message) }
  const { error: ue } = await admin.from('order_payment_records').update({
    confirmed_by: editor.employeeId, confirmed_by_name: editor.employeeName, confirmed_at: new Date().toISOString(),
  }).eq('id', recordId)
  if (ue) {
    await admin.from('erp_payment_matches').delete().eq('record_id', recordId)   // 반쪽 확정 방지
    return { error: errMsg(ue.message) }
  }
  // 거래처 없는 카드 매출은 기록의 매출처로 연결 (같은 승인번호의 승인 · 취소 행 모두)
  if (rec.vendor_id) {
    for (const meta of Array.from(cardApproval.values())) {
      if (!meta.vendor_id) await admin.from('card_sales').update({ vendor_id: rec.vendor_id }).eq('approval_number', meta.no).is('vendor_id', null)
    }
  }
  await writeLog(admin, recordId, 'confirm', editor,
    sources.map(s => `${s.source_type === 'bank' ? '통장' : '카드 매출'} ${paidDate.get(`${s.source_type}:${s.source_id}`)} ${won(s.amount)}원`).join(', '))
  return { ok: true, inserted: rowsToInsert.length }
}

export async function releaseRecord(admin: SupabaseClient, recordId: string, reason: string, editor: Editor): Promise<{ error: string } | { ok: true }> {
  const why = (reason ?? '').trim()
  if (why.length < 2) return { error: '확인 해제 사유를 입력하세요.' }
  const { data: rec, error } = await admin.from('order_payment_records').select('id, confirmed_at').eq('id', recordId).maybeSingle()
  if (error) return { error: errMsg(error.message) }
  if (!rec) return { error: '결제 기록을 찾을 수 없습니다.' }
  if (!rec.confirmed_at) return { error: '확인 대기 상태의 기록입니다.' }
  const { error: de } = await admin.from('erp_payment_matches').delete().eq('record_id', recordId)
  if (de) return { error: errMsg(de.message) }
  const { error: ue } = await admin.from('order_payment_records')
    .update({ confirmed_by: null, confirmed_by_name: null, confirmed_at: null }).eq('id', recordId)
  if (ue) return { error: errMsg(ue.message) }
  await writeLog(admin, recordId, 'release', editor, why.slice(0, 300))
  return { ok: true }
}
