import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrentUser } from './user-role'
import { fetchAllRows } from './fetch-all-rows'
import { loadReplyMap, REPLY_START, type ReplyInfo } from './order-reply'

// 주문 현황 목록·엑셀 내보내기 공용 필터 로직.
// 목록 API와 엑셀이 반드시 같은 결과 집합을 보도록 한 곳에 둔다.
//
// 통합 검색 다중 조건: 띄어쓰기·쉼표로 나눈 조건을 전부 만족(AND).
//  - "홍창의 하나은행 요아럽" → 각 단어가 어느 필드든 걸리는 주문
//  - "담당자-홍창의 업체-하나은행 품목-요아럽" → 필드 지정 (- 또는 : 구분)

export interface OrderListRow {
  id: string
  order_no: string | null
  order_date: string
  bank_name: string | null
  branch_name: string | null
  manager_name: string | null
  phone?: string | null             // 담당자 핸드폰 (목록 표시 · 검색, 2026-11-09)
  contact?: string | null           // 담당자 연락처(유선)
  staff_name: string | null
  total_amount: number | null
  outstanding_amount: number | null
  collect_status: string | null
  source: string | null
  memo?: string | null
  created_at: string
  canceled_at?: string | null      // 511 — 취소 주문 (집계 제외·배지)
  last_edited_at?: string | null   // 511 — 당일 수정됨 표시
}

type SearchField =
  | 'bank' | 'branch' | 'customer' | 'manager' | 'staff' | 'order_no'   // 주문 필드
  | 'item_name' | 'item_code' | 'channel' | 'purchase'                  // 품목 필드
const FIELD_MAP: Record<string, SearchField> = {
  '업체': 'bank', '은행': 'bank',
  '지점': 'branch', '부서': 'branch',
  '주문처': 'customer',
  '담당자': 'manager',
  '직원': 'staff', '다올직원': 'staff',
  '상담자': 'channel',
  '상품': 'item_name', '품목': 'item_name', '품명': 'item_name',
  '품번': 'item_code',
  '매입처': 'purchase',
  '주문번호': 'order_no', '번호': 'order_no',
}
const ITEM_COLUMNS: Partial<Record<SearchField, string[]>> = {
  item_name: ['item_name'],
  item_code: ['item_code'],
  channel: ['channel'],
  purchase: ['purchase_vendor_name'],
}

interface SearchToken { field: SearchField | null; value: string }

// "담당자-홍창의" / "담당자:홍창의" / 일반 키워드 파싱.
// 필드명 화이트리스트에 없는 접두(품번 "25-01" 등)는 일반 키워드로 취급.
function parseTokens(q: string): SearchToken[] {
  return q.split(/[\s,]+/).filter(Boolean).map(raw => {
    const m = raw.match(/^(.+?)[-:](.+)$/)
    if (m && FIELD_MAP[m[1]]) return { field: FIELD_MAP[m[1]], value: m[2].toLowerCase() }
    return { field: null, value: raw.toLowerCase() }
  })
}

export interface OrderListFilter {
  q?: string | null
  from?: string | null
  to?: string | null
  collect?: string | null    // all|collected|in_progress|outstanding
  source?: string | null     // all|direct|upload
  po?: string | null         // all|none|partial|full (direct 주문 전용)
  prepayOnly?: boolean
  vipOnly?: boolean          // 품명 'VIP' 품목이 있는 주문 (2026-11-09)
  invoiceOnly?: boolean
  mine?: boolean
  reply?: string | null      // all|wait|my_wait|my_req_wait|to_me|unable — 완료 회신 (515)
}

export function filterFromSearchParams(sp: URLSearchParams): OrderListFilter {
  return {
    q: (sp.get('q') ?? '').trim(),
    from: sp.get('from'),
    to: sp.get('to'),
    collect: sp.get('collect') ?? 'all',
    source: sp.get('source') ?? 'all',
    po: sp.get('po') ?? 'all',
    prepayOnly: sp.get('prepay') === '1',
    vipOnly: sp.get('vip') === '1',
    invoiceOnly: sp.get('invoice') === '1',
    mine: sp.get('mine') === '1',
    reply: sp.get('reply') ?? 'all',
  }
}

// ── 발주 상태 (3단계) ──────────────────────────────────
// direct 주문만 대상 — 업로드 주문은 기존 ERP에서 이미 발주 처리된 건.
// 유효(active) 발주서에 연결된 품목 수 vs 취소 제외 품목 수로 판정한다.
export type PoStatus = 'none' | 'partial' | 'full'

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export async function loadPoStatusMap(
  admin: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, PoStatus>> {
  const map = new Map<string, PoStatus>()
  if (!orderIds.length) return map
  const chunks = chunk(orderIds, 150)

  // 유효 발주서 (507 마이그레이션 미적용이면 전부 미발주로 표시)
  const poOrder = new Map<string, string>()   // po_id → order_id
  const poResults = await Promise.all(chunks.map(ch =>
    admin.from('erp_purchase_orders').select('id, order_id').eq('status', 'active').in('order_id', ch),
  ))
  for (const r of poResults) {
    if (r.error) { for (const id of orderIds) map.set(id, 'none'); return map }
    for (const p of r.data ?? []) poOrder.set(p.id as string, p.order_id as string)
  }

  // 발주서에 연결된 주문 품목 id (주문 수정으로 연결이 끊긴 행은 제외 → 미발주로 복귀)
  const linked = new Set<string>()
  await Promise.all(chunk(Array.from(poOrder.keys()), 150).map(async ch => {
    const r = await fetchAllRows<{ order_item_id: string }>((pf, pt) =>
      admin.from('erp_purchase_order_items').select('order_item_id')
        .in('po_id', ch).not('order_item_id', 'is', null).range(pf, pt),
    )
    if (!('error' in r)) for (const row of r.data) linked.add(row.order_item_id)
  }))

  // 주문별 유효 품목 수 대비 발주된 품목 수
  const counts = new Map<string, { total: number; done: number }>()
  await Promise.all(chunks.map(async ch => {
    const r = await fetchAllRows<{ id: string; order_id: string; is_canceled: boolean; is_prepayment: boolean }>((pf, pt) =>
      admin.from('erp_order_items').select('id, order_id, is_canceled, is_prepayment').in('order_id', ch).range(pf, pt),
    )
    if ('error' in r) return
    for (const it of r.data) {
      if (it.is_canceled || it.is_prepayment) continue   // 선결제는 발주 대상 아님
      let c = counts.get(it.order_id)
      if (!c) { c = { total: 0, done: 0 }; counts.set(it.order_id, c) }
      c.total += 1
      if (linked.has(it.id)) c.done += 1
    }
  }))

  for (const id of orderIds) {
    const c = counts.get(id)
    map.set(id, !c || c.done === 0 ? 'none' : c.done >= c.total ? 'full' : 'partial')
  }
  return map
}

// ── 표준 미수 (회계 트랙 단일 정의) ──────────────────────
// erp_orders.outstanding_amount는 원본값이라 수금 매칭(erp_payment_matches)을 반영하지 않는다.
// 매칭 차감은 DB 뷰 v_erp_order_receivable(406·416, = lib/receivable.ts)에서만 이뤄지므로
// 주문 화면의 미수·수금 상태는 반드시 이 뷰 값으로 표시한다. (2026-11-04)
export interface ReceivableInfo { outstanding: number; net_sales: number }

export async function loadReceivableMap(
  admin: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, ReceivableInfo> | null> {
  const map = new Map<string, ReceivableInfo>()
  if (!orderIds.length) return map
  const results = await Promise.all(chunk(orderIds, 150).map(ch =>
    admin.from('v_erp_order_receivable').select('order_id, outstanding, net_sales').in('order_id', ch),
  ))
  for (const r of results) {
    if (r.error) return null   // 뷰 미적용 등 — 호출 측이 원본값으로 폴백
    for (const v of r.data ?? []) {
      map.set(v.order_id as string, { outstanding: Number(v.outstanding ?? 0), net_sales: Number(v.net_sales ?? 0) })
    }
  }
  return map
}

// 수금 상태도 데이터에서 판정: 미수 0 = 수금완료 / 일부 수금 = 수금진행중 / 그 외 미수금
export function collectStatusFrom(rawStatus: string | null, r: ReceivableInfo): string {
  if (rawStatus === 'collected' || r.outstanding <= 0) return 'collected'
  if (r.outstanding < r.net_sales) return 'in_progress'
  return 'outstanding'
}

// 필터를 적용한 주문 집합 (정렬: 주문일·입력시각 내림차순)
export async function loadFilteredOrders(
  admin: SupabaseClient,
  me: CurrentUser,
  f: OrderListFilter,
): Promise<{ filtered: OrderListRow[]; prepayIds: Set<string>; vipIds: Set<string>; invoiceIds: Set<string>; poStatus: Map<string, PoStatus>; replyMap: Map<string, ReplyInfo>; replyCounts: ReplyCounts } | { error: string }> {
  // 1) 기간 필터로 주문 로드 (나머지 필터는 메모리) — 511 미적용이면 기존 컬럼으로 폴백
  const baseCols = 'id, order_no, order_date, bank_name, branch_name, manager_name, phone, contact, staff_name, total_amount, outstanding_amount, collect_status, source, memo, created_at'
  const loadBase = (cols: string) => fetchAllRows<OrderListRow>((pf, pt) => {
    let query = admin.from('erp_orders').select(cols)
    if (f.from) query = query.gte('order_date', f.from)
    if (f.to) query = query.lte('order_date', f.to)
    return query.order('order_date', { ascending: false }).range(pf, pt) as unknown as PromiseLike<{ data: OrderListRow[] | null; error: { message: string } | null }>
  })
  let base = await loadBase(`${baseCols}, canceled_at, last_edited_at`)
  if ('error' in base) base = await loadBase(baseCols)
  if ('error' in base) return { error: base.error }

  // 2) 통합 검색 — 조건별 품목 매칭 주문 id 집합 (필드 지정 시 해당 컬럼만)
  const tokens = f.q ? parseTokens(f.q) : []
  const tokenItemIds: (Set<string> | null)[] = await Promise.all(tokens.map(async tk => {
    const cols = tk.field === null
      ? ['item_name', 'item_code', 'channel']
      : (ITEM_COLUMNS[tk.field] ?? [])
    if (!cols.length) return null   // 주문 필드 전용 조건
    const results = await Promise.all(cols.map(col =>
      fetchAllRows<{ order_id: string }>((pf, pt) =>
        admin.from('erp_order_items').select('order_id').ilike(col, `%${tk.value}%`).range(pf, pt),
      ),
    ))
    const ids = new Set<string>()
    for (const r of results) {
      if (!('error' in r)) for (const row of r.data) ids.add(row.order_id)
    }
    return ids
  }))

  // 3) 선결제·계산서 주문 집합 (배지·필터 공용)
  const [prepayResult, vipResult, invoiceResult] = await Promise.all([
    fetchAllRows<{ order_id: string }>((pf, pt) =>
      admin.from('erp_order_items').select('order_id').eq('is_prepayment', true).range(pf, pt),
    ),
    fetchAllRows<{ order_id: string }>((pf, pt) =>
      admin.from('erp_order_items').select('order_id').eq('is_vip', true).range(pf, pt),
    ),
    fetchAllRows<{ order_id: string }>((pf, pt) =>
      admin.from('erp_order_invoices').select('order_id').range(pf, pt),
    ),
  ])
  const prepayIds = new Set('error' in prepayResult ? [] : prepayResult.data.map(r => r.order_id))
  const vipIds = new Set('error' in vipResult ? [] : vipResult.data.map(r => r.order_id))
  const invoiceIds = new Set('error' in invoiceResult ? [] : invoiceResult.data.map(r => r.order_id))

  // 조건 1개가 주문에 걸리는지: 주문 필드 매칭 또는 품목 매칭
  const tokenMatches = (o: OrderListRow, tk: SearchToken, itemIds: Set<string> | null): boolean => {
    const has = (v: string | null) => (v ?? '').toLowerCase().includes(tk.value)
    const orderMatch = (() => {
      switch (tk.field) {
        case null: return [o.order_no, o.bank_name, o.branch_name, o.manager_name, o.phone ?? null, o.contact ?? null, o.staff_name].some(has)
        case 'bank': return has(o.bank_name)
        case 'branch': return has(o.branch_name)
        case 'customer': return has([o.bank_name, o.branch_name].filter(Boolean).join(' '))
        case 'manager': return has(o.manager_name) || has(o.phone ?? null) || has(o.contact ?? null)
        case 'staff': return has(o.staff_name)
        case 'order_no': return has(o.order_no)
        default: return false   // 품목 전용 필드
      }
    })()
    return orderMatch || (itemIds?.has(o.id) ?? false)
  }

  let filtered = base.data.filter(o => {
    if (tokens.length && !tokens.every((tk, i) => tokenMatches(o, tk, tokenItemIds[i]))) return false
    if (f.source && f.source !== 'all' && (o.source ?? 'upload') !== f.source) return false
    if (f.prepayOnly && !prepayIds.has(o.id)) return false
    if (f.vipOnly && !vipIds.has(o.id)) return false
    if (f.invoiceOnly && !invoiceIds.has(o.id)) return false
    if (f.mine && me.employeeName && o.staff_name !== me.employeeName) return false
    return true
  })

  // 3-1) 미수·수금 상태를 표준 미수(매칭 반영)로 교체한 뒤 수금 필터 적용. 취소 주문은 미수 0·상태 유지
  const recv = await loadReceivableMap(admin, filtered.filter(o => !o.canceled_at).map(o => o.id))
  if (recv) {
    for (const o of filtered) {
      if (o.canceled_at) { o.outstanding_amount = 0; continue }
      const r = recv.get(o.id)
      if (!r) continue
      o.outstanding_amount = r.outstanding
      o.collect_status = collectStatusFrom(o.collect_status, r)
    }
  }
  if (f.collect && f.collect !== 'all') filtered = filtered.filter(o => o.collect_status === f.collect)

  // 4) 발주 상태 (direct 주문 전용 배지·필터)
  const directIds = filtered.filter(o => (o.source ?? 'upload') === 'direct').map(o => o.id)
  const poStatus = await loadPoStatusMap(admin, directIds)
  if (f.po && f.po !== 'all') {
    filtered = filtered.filter(o => poStatus.get(o.id) === f.po)
  }

  const REPLY_START_MS = Date.parse(REPLY_START)
  // 5) 완료 회신 (515) — 대상 주문만 맵에 있음. 숫자는 회신 필터 적용 전 기준
  const replyIds = filtered.filter(o => (o.source ?? 'upload') === 'direct' && !o.canceled_at && Date.parse(o.created_at) >= REPLY_START_MS).map(o => o.id)
  const replyMap = await loadReplyMap(admin, replyIds)
  const isMe = (id: string | null) => !!me.employeeId && id === me.employeeId
  const replyTest: Record<string, (r: ReplyInfo) => boolean> = {
    wait: r => r.state === 'waiting',
    my_wait: r => r.state === 'waiting' && isMe(r.entrant),
    // 내 상담 회신 대기 (2026-11-06 B안): 내가 요청자 · 상담자인 주문 중 아직 회신 안 온 것
    my_req_wait: r => r.state === 'waiting' && r.recipients.some(isMe),
    to_me: r => r.state !== 'waiting' && r.recipients.some(isMe),
    unable: r => r.state === 'unable',
  }
  const replyCounts: ReplyCounts = { wait: 0, my_wait: 0, my_req_wait: 0, to_me: 0, unable: 0 }
  for (const r of Array.from(replyMap.values())) {
    for (const k of Object.keys(replyCounts) as (keyof ReplyCounts)[]) if (replyTest[k](r)) replyCounts[k] += 1
  }
  if (f.reply && f.reply !== 'all' && replyTest[f.reply]) {
    const test = replyTest[f.reply]
    filtered = filtered.filter(o => { const r = replyMap.get(o.id); return !!r && test(r) })
  }

  filtered.sort((a, b) =>
    a.order_date !== b.order_date
      ? (a.order_date < b.order_date ? 1 : -1)
      : (a.created_at < b.created_at ? 1 : -1))

  return { filtered, prepayIds, vipIds, invoiceIds, poStatus, replyMap, replyCounts }
}

export interface ReplyCounts { wait: number; my_wait: number; my_req_wait: number; to_me: number; unable: number }
