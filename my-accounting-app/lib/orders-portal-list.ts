import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrentUser } from './user-role'
import { fetchAllRows } from './fetch-all-rows'

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
  staff_name: string | null
  total_amount: number | null
  outstanding_amount: number | null
  collect_status: string | null
  source: string | null
  memo?: string | null
  created_at: string
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
  invoiceOnly?: boolean
  mine?: boolean
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
    invoiceOnly: sp.get('invoice') === '1',
    mine: sp.get('mine') === '1',
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
    const r = await fetchAllRows<{ id: string; order_id: string; is_canceled: boolean }>((pf, pt) =>
      admin.from('erp_order_items').select('id, order_id, is_canceled').in('order_id', ch).range(pf, pt),
    )
    if ('error' in r) return
    for (const it of r.data) {
      if (it.is_canceled) continue
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

// 필터를 적용한 주문 집합 (정렬: 주문일·입력시각 내림차순)
export async function loadFilteredOrders(
  admin: SupabaseClient,
  me: CurrentUser,
  f: OrderListFilter,
): Promise<{ filtered: OrderListRow[]; prepayIds: Set<string>; invoiceIds: Set<string>; poStatus: Map<string, PoStatus> } | { error: string }> {
  // 1) 기간 필터로 주문 로드 (나머지 필터는 메모리)
  const base = await fetchAllRows<OrderListRow>((pf, pt) => {
    let query = admin.from('erp_orders')
      .select('id, order_no, order_date, bank_name, branch_name, manager_name, staff_name, total_amount, outstanding_amount, collect_status, source, memo, created_at')
    if (f.from) query = query.gte('order_date', f.from)
    if (f.to) query = query.lte('order_date', f.to)
    return query.order('order_date', { ascending: false }).range(pf, pt)
  })
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
  const [prepayResult, invoiceResult] = await Promise.all([
    fetchAllRows<{ order_id: string }>((pf, pt) =>
      admin.from('erp_order_items').select('order_id').eq('is_prepayment', true).range(pf, pt),
    ),
    fetchAllRows<{ order_id: string }>((pf, pt) =>
      admin.from('erp_order_invoices').select('order_id').range(pf, pt),
    ),
  ])
  const prepayIds = new Set('error' in prepayResult ? [] : prepayResult.data.map(r => r.order_id))
  const invoiceIds = new Set('error' in invoiceResult ? [] : invoiceResult.data.map(r => r.order_id))

  // 조건 1개가 주문에 걸리는지: 주문 필드 매칭 또는 품목 매칭
  const tokenMatches = (o: OrderListRow, tk: SearchToken, itemIds: Set<string> | null): boolean => {
    const has = (v: string | null) => (v ?? '').toLowerCase().includes(tk.value)
    const orderMatch = (() => {
      switch (tk.field) {
        case null: return [o.order_no, o.bank_name, o.branch_name, o.manager_name, o.staff_name].some(has)
        case 'bank': return has(o.bank_name)
        case 'branch': return has(o.branch_name)
        case 'customer': return has([o.bank_name, o.branch_name].filter(Boolean).join(' '))
        case 'manager': return has(o.manager_name)
        case 'staff': return has(o.staff_name)
        case 'order_no': return has(o.order_no)
        default: return false   // 품목 전용 필드
      }
    })()
    return orderMatch || (itemIds?.has(o.id) ?? false)
  }

  let filtered = base.data.filter(o => {
    if (tokens.length && !tokens.every((tk, i) => tokenMatches(o, tk, tokenItemIds[i]))) return false
    if (f.collect && f.collect !== 'all' && o.collect_status !== f.collect) return false
    if (f.source && f.source !== 'all' && (o.source ?? 'upload') !== f.source) return false
    if (f.prepayOnly && !prepayIds.has(o.id)) return false
    if (f.invoiceOnly && !invoiceIds.has(o.id)) return false
    if (f.mine && me.employeeName && o.staff_name !== me.employeeName) return false
    return true
  })

  // 4) 발주 상태 (direct 주문 전용 배지·필터)
  const directIds = filtered.filter(o => (o.source ?? 'upload') === 'direct').map(o => o.id)
  const poStatus = await loadPoStatusMap(admin, directIds)
  if (f.po && f.po !== 'all') {
    filtered = filtered.filter(o => poStatus.get(o.id) === f.po)
  }

  filtered.sort((a, b) =>
    a.order_date !== b.order_date
      ? (a.order_date < b.order_date ? 1 : -1)
      : (a.created_at < b.created_at ? 1 : -1))

  return { filtered, prepayIds, invoiceIds, poStatus }
}
