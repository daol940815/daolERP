import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { loadReceivableMap } from './orders-portal-list'
import { loadPayStateMap } from './pay-state-server'
import type { PayState } from './pay-state'
import { honorify } from './contact-label'
import { DATA_START } from './period-presets'
import { kindLabel } from './payment-kind'
import { loadRecentUnmatches, type UnmatchLog } from './match-log'

// ── 결제 확인 › 전체 현황 (2026-11-18 실무자 요청 — 시안 docs/mockups/결제확인_탭5개_시안.html) ──
// 속도(2026-11-18): 목록(loadOverview)은 검색 · 필터 · 상태 판정에 필요한 것만 전체로 읽고, 매칭 내역 · 원본 이름 · 연락 기록은
//   줄을 펼칠 때 그 주문 것만 읽는다(loadOverviewDetail). 화면은 100건씩 그린다. 주문이 수천 건이 되면 상태 계산을 DB 한 번 호출(RPC)로 옮길 것.
// 주문 한 줄씩, 결제 상태(주문내역 목록과 같은 5단계)로 거르는 "보는 화면". 확정 · 연락 기록은 매칭 대기 · 결제 안내 대상 탭에서 한다.
// 예외로 매칭 해제만 여기서 한다(입금대장의 '매칭 내역'을 없애고 옮겨 옴).
// 지점 담당 = vendor_staff 의 현재 배정(ended_at IS NULL) — 사용자 결정: 고객별 다올 담당 · 주문의 상담자가 아니다.
const chunk = <T,>(a: T[], n = 150) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

export interface StaffInfo { vendor_id: string | null; staff_ids: string[]; staff_names: string[] }

// 주문 → 매출처(별칭의 거래처 우선) → 지점 담당. 담당이 없으면 빈 배열(= 담당 미지정)
export async function loadOrderStaff(admin: SupabaseClient, orders: { id: string; customer_alias_id?: string | null; vendor_id?: string | null }[]): Promise<Map<string, StaffInfo>> {
  const aliasIds = Array.from(new Set(orders.map(o => o.customer_alias_id).filter((x): x is string => !!x)))
  const aliasVendor = new Map<string, string>()
  for (const ch of chunk(aliasIds)) {
    const { data } = await admin.from('erp_vendor_aliases').select('id, vendor_id').in('id', ch)
    for (const a of data ?? []) if (a.vendor_id) aliasVendor.set(a.id as string, a.vendor_id as string)
  }
  const vendorOf = new Map<string, string | null>()
  for (const o of orders) vendorOf.set(o.id, (o.customer_alias_id ? aliasVendor.get(o.customer_alias_id) : null) ?? o.vendor_id ?? null)
  const byVendor = await loadVendorStaff(admin, Array.from(new Set(Array.from(vendorOf.values()).filter((x): x is string => !!x))))
  const out = new Map<string, StaffInfo>()
  for (const o of orders) {
    const v = vendorOf.get(o.id) ?? null
    const s = v ? byVendor.get(v) : undefined
    out.set(o.id, { vendor_id: v, staff_ids: s?.ids ?? [], staff_names: s?.names ?? [] })
  }
  return out
}

export async function loadVendorStaff(admin: SupabaseClient, vendorIds: string[]): Promise<Map<string, { ids: string[]; names: string[] }>> {
  const out = new Map<string, { ids: string[]; names: string[] }>()
  type Row = { vendor_id: string; employee_id: string | null; is_primary: boolean | null; employees: { name: string } | { name: string }[] | null }
  for (const ch of chunk(vendorIds)) {
    const { data, error } = await admin.from('vendor_staff').select('vendor_id, employee_id, is_primary, employees(name)').in('vendor_id', ch).is('ended_at', null)
    if (error) return out
    const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))   // 주담당 먼저
    for (const r of rows) {
      const name = (Array.isArray(r.employees) ? r.employees[0]?.name : r.employees?.name) ?? null
      if (!r.employee_id || !name) continue
      const cur = out.get(r.vendor_id) ?? { ids: [], names: [] }
      if (!cur.ids.includes(r.employee_id)) { cur.ids.push(r.employee_id); cur.names.push(name) }
      out.set(r.vendor_id, cur)
    }
  }
  return out
}

export interface OverviewRecord {
  id: string; cancel: boolean; method: string; kind: string | null; pay_date: string; amount: number   // amount = 이 주문 몫 (취소 줄은 취소 금액)
  clue: string; created_by_name: string | null; created_at: string
  confirmed_by_name: string | null; confirmed_at: string | null
}
export interface OverviewMatch {
  id: string; source_type: string; label: string; amount: number; paid_date: string
  matched_by_name: string | null; created_at: string | null
  record_id: string | null; derived: boolean      // derived = 계산서 입금에서 넘어온 수금(여기서 풀 수 없다)
}
export interface OverviewRow extends StaffInfo {
  order_id: string; order_no: string | null; order_date: string
  customer_name: string; manager: string
  net: number; outstanding: number; pay: PayState
  records: OverviewRecord[]
}
// 줄을 펼칠 때 따로 읽는 상세 (2026-11-18 — 목록은 가볍게, 무거운 것은 보이는 줄만)
export interface OverviewDetail { matches: OverviewMatch[]; contact_count: number; last_contact: string | null }

export async function loadOverview(admin: SupabaseClient): Promise<{ error: string } | { rows: OverviewRow[]; released: UnmatchLog[] }> {
  type O = { id: string; order_no: string | null; order_date: string; bank_name: string | null; branch_name: string | null; manager_name: string | null; customer_alias_id: string | null; vendor_id: string | null }
  const res = await fetchAllRows<O>((f, t) => admin.from('erp_orders')
    .select('id, order_no, order_date, bank_name, branch_name, manager_name, customer_alias_id, vendor_id')
    .eq('source', 'direct').is('canceled_at', null).gte('order_date', DATA_START)
    .order('order_date', { ascending: false }).order('order_no', { ascending: false }).range(f, t))
  if ('error' in res) return { error: res.error }
  const orders = res.data
  const ids = orders.map(o => o.id)
  const recv = await loadReceivableMap(admin, ids)
  if (!recv) return { error: '미수 계산 뷰(v_erp_order_receivable)를 읽지 못했습니다.' }
  const [payMap, staff] = await Promise.all([
    loadPayStateMap(admin, ids.map(id => ({ id, canceled: false })), recv),
    loadOrderStaff(admin, orders),
  ])

  // 결제 기록 (원 기록 + 취소 줄, 이 주문 몫)
  const links: { order_id: string; record_id: string; amount: number }[] = []
  for (const ch of chunk(ids)) {
    // 묶음마다 끝까지 읽는다 — 한 번 조회는 1000행에서 잘린다(주문이 많아져도 기록 · 매칭이 빠지지 않게)
    const r = await fetchAllRows<typeof links[number]>((f, t) => admin.from('order_payment_record_orders').select('order_id, record_id, amount').in('order_id', ch).range(f, t))
    if ('error' in r) break   // 1300 미적용 — 기록 없이 보여 준다
    links.push(...r.data)
  }
  type Rec = { id: string; method: string; pay_date: string; approval_number: string | null; card_last4: string | null; depositor_name: string | null; due_date: string | null
    created_by_name: string | null; created_at: string; confirmed_by_name: string | null; confirmed_at: string | null; card_entry?: string | null; vat_kind?: string | null; cancel_of?: string | null; reason_text?: string | null }
  const recs = new Map<string, Rec>()
  const BASE = 'id, method, pay_date, approval_number, card_last4, depositor_name, due_date, created_by_name, created_at, confirmed_by_name, confirmed_at'
  for (const ch of chunk(Array.from(new Set(links.map(l => l.record_id))))) {
    let r = await admin.from('order_payment_records').select(`${BASE}, card_entry, vat_kind, cancel_of, reason_text`).in('id', ch)
    if (r.error) r = await admin.from('order_payment_records').select(BASE).in('id', ch) as unknown as typeof r
    for (const x of (r.data ?? []) as unknown as Rec[]) recs.set(x.id, x)
  }
  const clueOf = (r: Rec) => r.cancel_of ? `취소 — ${r.reason_text ?? ''}`.trim()
    : r.method === 'card' ? [r.approval_number && `승인 ${r.approval_number}`, r.card_last4 && `카드 뒤 ${r.card_last4}`].filter(Boolean).join(' · ')
      : r.method === 'transfer' ? (r.depositor_name ? `입금자 ${r.depositor_name}` : '입금자 미기재') : (r.due_date ? `입금 예정 ${r.due_date}` : '입금 예정일 미기재')
  const recByOrder = new Map<string, OverviewRecord[]>()
  for (const l of links) {
    const r = recs.get(l.record_id); if (!r) continue
    const list = recByOrder.get(l.order_id) ?? []
    list.push({
      id: r.id, cancel: !!r.cancel_of, method: r.method, kind: kindLabel({ card_entry: (r.card_entry ?? null) as never, vat_kind: (r.vat_kind ?? null) as never }),
      pay_date: r.pay_date, amount: Number(l.amount ?? 0), clue: clueOf(r),
      created_by_name: r.created_by_name, created_at: r.created_at, confirmed_by_name: r.confirmed_by_name, confirmed_at: r.confirmed_at,
    })
    recByOrder.set(l.order_id, list)
  }

  const rows: OverviewRow[] = orders.map(o => ({
    order_id: o.id, order_no: o.order_no, order_date: o.order_date,
    customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' '), manager: honorify(o.manager_name),
    ...(staff.get(o.id) ?? { vendor_id: null, staff_ids: [], staff_names: [] }),
    net: recv.get(o.id)?.net_sales ?? 0, outstanding: recv.get(o.id)?.outstanding ?? 0, pay: payMap.get(o.id)!,
    records: (recByOrder.get(o.id) ?? []).sort((a, b) => a.pay_date.localeCompare(b.pay_date) || a.created_at.localeCompare(b.created_at)),
  }))
  return { rows, released: await loadRecentUnmatches(admin) }
}

export async function loadOverviewDetail(admin: SupabaseClient, orderId: string): Promise<OverviewDetail> {
  type M = { id: string; order_id: string; source_type: string; source_id: string; amount: number; paid_date: string; record_id: string | null; from_invoice_id?: string | null; matched_by_name?: string | null; created_at?: string | null }
  const { data: ms } = await admin.from('erp_payment_matches').select('*').eq('order_id', orderId)
  const matches = (ms ?? []) as M[]
  const label = new Map<string, string>()
  const bankIds = Array.from(new Set(matches.filter(m => m.source_type === 'bank').map(m => m.source_id)))
  const cardIds = Array.from(new Set(matches.filter(m => m.source_type === 'card').map(m => m.source_id)))
  const [t, c, ct] = await Promise.all([
    bankIds.length ? admin.from('transactions').select('id, counterparty_name, description').in('id', bankIds.slice(0, 150)) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    cardIds.length ? admin.from('card_sales').select('id, approval_number').in('id', cardIds.slice(0, 150)) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    admin.from('order_payment_contacts').select('contact_date').eq('order_id', orderId).order('contact_date', { ascending: false }),
  ])
  for (const x of t.data ?? []) label.set(x.id as string, `통장 ${String(x.counterparty_name || x.description || '').slice(0, 20)}`.trim())
  for (const x of c.data ?? []) label.set(x.id as string, `카드 매출 승인 ${x.approval_number ?? ''}`.trim())
  return {
    matches: matches.map(m => ({
      id: m.id, source_type: m.source_type, amount: Number(m.amount ?? 0), paid_date: String(m.paid_date).slice(0, 10),
      label: m.source_type === 'prepay' ? '선결제 사용' : Number(m.amount ?? 0) < 0 ? `환불 ${label.get(m.source_id) ?? '출금'}` : (label.get(m.source_id) ?? m.source_type),
      matched_by_name: m.matched_by_name ?? null, created_at: m.created_at ?? null, record_id: m.record_id ?? null, derived: !!m.from_invoice_id,
    })).sort((a, b) => a.paid_date.localeCompare(b.paid_date)),
    contact_count: ct.error ? 0 : (ct.data?.length ?? 0), last_contact: ct.error ? null : ((ct.data?.[0]?.contact_date as string | undefined) ?? null),
  }
}

// 매칭된 원본의 이름으로 주문 찾기 (2026-11-18) — 목록에는 매칭 내역을 싣지 않으므로(가볍게), 입금자 · 승인번호 검색은 서버가 원본에서 찾아 주문 id 를 돌려준다.
//   입금자: 통장 거래의 입금자 · 적요에 검색어가 들어간 입금 → 그 입금이 붙은 주문 / 승인번호: 카드 매출의 승인번호 → 그 결제가 붙은 주문
export async function findOrdersByMatchedSource(admin: SupabaseClient, q: string, field: 'all' | 'depositor' | 'approval'): Promise<string[]> {
  const kw = q.trim().replace(/[%,()]/g, ' ').trim()
  if (kw.length < 2) return []
  const out = new Set<string>()
  const collect = async (type: 'bank' | 'card', ids: string[]) => {
    for (const ch of chunk(ids)) {
      const r = await fetchAllRows<{ order_id: string }>((f, t) => admin.from('erp_payment_matches').select('order_id').eq('source_type', type).in('source_id', ch).range(f, t))
      if (!('error' in r)) for (const m of r.data) out.add(m.order_id)
    }
  }
  if (field !== 'approval') {
    const r = await fetchAllRows<{ id: string }>((f, t) => admin.from('transactions').select('id')
      .or(`counterparty_name.ilike.%${kw}%,description.ilike.%${kw}%`).gte('tx_date', DATA_START).range(f, t))
    if (!('error' in r)) await collect('bank', r.data.map(x => x.id))
  }
  const digits = kw.replace(/[^0-9a-z]/gi, '')
  if (field !== 'depositor' && digits.length >= 3) {
    const r = await fetchAllRows<{ id: string }>((f, t) => admin.from('card_sales').select('id').ilike('approval_number', `%${digits}%`).eq('transaction_type', 'approval').range(f, t))
    if (!('error' in r)) await collect('card', r.data.map(x => x.id))
  }
  return Array.from(out)
}

// ── 주문 미리보기 (주문번호를 누르면 뜨는 보기 전용 창) — 매입가 · 마진은 내려보내지 않는다 ──
export interface OrderPreview {
  order_id: string; order_no: string | null; order_date: string; canceled: boolean
  customer_name: string; manager: string; counselor: string | null; staff_names: string[]
  items: { item_name: string | null; quantity: number; sale_price: number; line_total: number; flag: string | null }[]
  net: number; outstanding: number; pay: PayState | null
  records: OverviewRecord[]; match_count: number; contact_count: number; memo: string | null
}

export async function loadOrderPreview(admin: SupabaseClient, orderId: string): Promise<{ error: string } | OrderPreview> {
  const { data: o } = await admin.from('erp_orders')
    .select('id, order_no, order_date, bank_name, branch_name, manager_name, staff_name, memo, canceled_at, customer_alias_id, vendor_id, counselor_employee_id').eq('id', orderId).maybeSingle()
  if (!o) return { error: '주문을 찾을 수 없습니다.' }
  const [{ data: items }, recv, staff, counselor] = await Promise.all([
    admin.from('erp_order_items').select('item_name, quantity, sale_price, line_total, is_canceled, is_vip, is_prepayment, line_no').eq('order_id', orderId).order('line_no'),
    loadReceivableMap(admin, [orderId]),
    loadOrderStaff(admin, [{ id: orderId, customer_alias_id: o.customer_alias_id as string | null, vendor_id: o.vendor_id as string | null }]),
    o.counselor_employee_id ? admin.from('employees').select('name').eq('id', o.counselor_employee_id as string).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const payMap = recv ? await loadPayStateMap(admin, [{ id: orderId, canceled: !!o.canceled_at }], recv) : new Map<string, PayState>()
  // 기록 · 매칭 · 연락 건수는 전체 현황과 같은 모양으로 — 한 주문이라 직접 읽는다
  const { data: links } = await admin.from('order_payment_record_orders').select('record_id, amount').eq('order_id', orderId)
  const recIds = (links ?? []).map(l => l.record_id as string)
  const records: OverviewRecord[] = []
  if (recIds.length) {
    const BASE = 'id, method, pay_date, approval_number, card_last4, depositor_name, due_date, created_by_name, created_at, confirmed_by_name, confirmed_at'
    let r = await admin.from('order_payment_records').select(`${BASE}, card_entry, vat_kind, cancel_of, reason_text`).in('id', recIds.slice(0, 150))
    if (r.error) r = await admin.from('order_payment_records').select(BASE).in('id', recIds.slice(0, 150)) as unknown as typeof r
    for (const x of (r.data ?? []) as unknown as Record<string, string | null>[]) {
      records.push({
        id: x.id as string, cancel: !!x.cancel_of, method: x.method as string, kind: kindLabel({ card_entry: (x.card_entry ?? null) as never, vat_kind: (x.vat_kind ?? null) as never }),
        pay_date: x.pay_date as string, amount: Number((links ?? []).find(l => l.record_id === x.id)?.amount ?? 0),
        clue: x.cancel_of ? `취소 — ${x.reason_text ?? ''}`.trim() : x.method === 'card' ? `승인 ${x.approval_number ?? ''}` : x.method === 'transfer' ? `입금자 ${x.depositor_name ?? '미기재'}` : `입금 예정 ${x.due_date ?? '미기재'}`,
        created_by_name: x.created_by_name, created_at: x.created_at as string, confirmed_by_name: x.confirmed_by_name, confirmed_at: x.confirmed_at,
      })
    }
    records.sort((a, b) => a.pay_date.localeCompare(b.pay_date) || a.created_at.localeCompare(b.created_at))
  }
  const [{ count: mc }, cc] = await Promise.all([
    admin.from('erp_payment_matches').select('id', { count: 'exact', head: true }).eq('order_id', orderId),
    admin.from('order_payment_contacts').select('id', { count: 'exact', head: true }).eq('order_id', orderId),
  ])
  return {
    order_id: orderId, order_no: o.order_no as string | null, order_date: o.order_date as string, canceled: !!o.canceled_at,
    customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' '), manager: honorify(o.manager_name as string | null),
    counselor: (counselor.data?.name as string | undefined) ?? (o.staff_name as string | null), staff_names: staff.get(orderId)?.staff_names ?? [],
    items: ((items ?? []) as Record<string, unknown>[]).map(it => ({
      item_name: it.item_name as string | null, quantity: Number(it.quantity ?? 0), sale_price: Number(it.sale_price ?? 0), line_total: Number(it.line_total ?? 0),
      flag: it.is_canceled ? '취소' : it.is_vip ? 'VIP' : it.is_prepayment ? '선결제' : null,
    })),
    net: recv?.get(orderId)?.net_sales ?? 0, outstanding: o.canceled_at ? 0 : (recv?.get(orderId)?.outstanding ?? 0), pay: payMap.get(orderId) ?? null,
    records, match_count: mc ?? 0, contact_count: cc.error ? 0 : (cc.count ?? 0), memo: (o.memo as string | null) ?? null,
  }
}

// 공통 필터(지점 담당)의 기본값 · 선택지 — 로그인한 직원에게 담당 지점이 하나라도 있는지, 담당을 맡은 직원 목록
export interface StaffScope { me: { id: string | null; name: string | null; has_vendors: boolean }; options: { id: string; name: string }[] }
export async function loadStaffScope(admin: SupabaseClient, me: { employeeId: string | null; employeeName: string | null }): Promise<StaffScope> {
  type Row = { employee_id: string | null; employees: { name: string } | { name: string }[] | null }
  const res = await fetchAllRows<Row>((f, t) => admin.from('vendor_staff').select('employee_id, employees(name)').is('ended_at', null).range(f, t))
  const names = new Map<string, string>()
  if (!('error' in res)) for (const r of res.data) {
    const name = (Array.isArray(r.employees) ? r.employees[0]?.name : r.employees?.name) ?? null
    if (r.employee_id && name) names.set(r.employee_id, name)
  }
  return {
    me: { id: me.employeeId, name: me.employeeName, has_vendors: !!me.employeeId && names.has(me.employeeId) },
    options: Array.from(names, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }
}
