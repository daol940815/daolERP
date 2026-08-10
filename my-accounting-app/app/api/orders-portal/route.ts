import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// 주문 현황 목록 (시안 v2) — KPI + 통합 검색(품목 포함) + 칩 필터 + 페이지네이션
//
// 통합 검색 다중 조건: 띄어쓰기·쉼표로 나눈 조건을 전부 만족(AND)해야 한다.
//  - "홍창의 하나은행 요아럽" → 세 단어가 각각 어느 필드든 걸리는 주문
//  - "담당자-홍창의 업체-하나은행 품목-요아럽" → 필드 지정 (- 또는 : 구분)
//
// 규모 전제: 주문 ~1만 건 수준이라 필터된 집합을 메모리로 집계한다.
// (10만 단위로 커지면 102 hub_summary_json 패턴의 RPC로 이관 — 트랙 문서 참고)
//
// GET ?q=&from=&to=&collect=&source=&prepay=1&invoice=1&mine=1&page=1

const PER_PAGE = 50

// 검색 필드 지정어 → 대상 필드
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

interface OrderRow {
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
  created_at: string
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams

  const q = (sp.get('q') ?? '').trim().toLowerCase()
  const from = sp.get('from')
  const to = sp.get('to')
  const collect = sp.get('collect') ?? 'all'          // all|collected|in_progress|outstanding
  const source = sp.get('source') ?? 'all'            // all|direct|upload
  const prepayOnly = sp.get('prepay') === '1'
  const invoiceOnly = sp.get('invoice') === '1'
  const mine = sp.get('mine') === '1'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)

  // 1) 기간 필터로 주문 최소 컬럼 로드 (나머지 필터는 메모리)
  const base = await fetchAllRows<OrderRow>((f, t) => {
    let query = admin.from('erp_orders')
      .select('id, order_no, order_date, bank_name, branch_name, manager_name, staff_name, total_amount, outstanding_amount, collect_status, source, created_at')
    if (from) query = query.gte('order_date', from)
    if (to) query = query.lte('order_date', to)
    return query.order('order_date', { ascending: false }).range(f, t)
  })
  if ('error' in base) return NextResponse.json({ error: base.error }, { status: 500 })

  // 2) 통합 검색 (다중 조건 AND) — 주문 필드는 메모리, 품목 필드는 테이블 조회
  const tokens = q ? parseTokens(q) : []
  // 조건별로 품목 매칭 주문 id 집합을 구한다 (필드 지정 시 해당 컬럼만)
  const tokenItemIds: (Set<string> | null)[] = await Promise.all(tokens.map(async tk => {
    const cols = tk.field === null
      ? ['item_name', 'item_code', 'channel']
      : (ITEM_COLUMNS[tk.field] ?? [])
    if (!cols.length) return null   // 주문 필드 전용 조건
    const results = await Promise.all(cols.map(col =>
      fetchAllRows<{ order_id: string }>((f, t) =>
        admin.from('erp_order_items').select('order_id').ilike(col, `%${tk.value}%`).range(f, t),
      ),
    ))
    const ids = new Set<string>()
    for (const r of results) {
      if (!('error' in r)) for (const row of r.data) ids.add(row.order_id)
    }
    return ids
  }))

  // 3) 선결제·계산서 주문 집합 (배지 표시용 — 필터 없어도 로드)
  const [prepayResult, invoiceResult] = await Promise.all([
    fetchAllRows<{ order_id: string }>((f, t) =>
      admin.from('erp_order_items').select('order_id').eq('is_prepayment', true).range(f, t),
    ),
    fetchAllRows<{ order_id: string }>((f, t) =>
      admin.from('erp_order_invoices').select('order_id').range(f, t),
    ),
  ])
  const prepayIds = new Set('error' in prepayResult ? [] : prepayResult.data.map(r => r.order_id))
  const invoiceIds = new Set('error' in invoiceResult ? [] : invoiceResult.data.map(r => r.order_id))

  // 조건 1개가 주문에 걸리는지: 주문 필드 매칭 또는 품목 매칭
  const tokenMatches = (o: OrderRow, tk: SearchToken, itemIds: Set<string> | null): boolean => {
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

  const filtered = base.data.filter(o => {
    if (tokens.length && !tokens.every((tk, i) => tokenMatches(o, tk, tokenItemIds[i]))) return false
    if (collect !== 'all' && o.collect_status !== collect) return false
    if (source !== 'all' && (o.source ?? 'upload') !== source) return false
    if (prepayOnly && !prepayIds.has(o.id)) return false
    if (invoiceOnly && !invoiceIds.has(o.id)) return false
    if (mine && me.employeeName && o.staff_name !== me.employeeName) return false
    return true
  })

  // 4) KPI (필터 결과 기준)
  const kpi = {
    count: filtered.length,
    total: filtered.reduce((s, o) => s + (o.total_amount ?? 0), 0),
    outstanding: filtered.reduce((s, o) => s + (o.outstanding_amount ?? 0), 0),
    outstanding_cnt: filtered.filter(o => o.collect_status === 'outstanding').length,
    in_progress_cnt: filtered.filter(o => o.collect_status === 'in_progress').length,
    direct_cnt: filtered.filter(o => o.source === 'direct').length,
  }

  // 5) 정렬·페이지
  filtered.sort((a, b) =>
    a.order_date !== b.order_date
      ? (a.order_date < b.order_date ? 1 : -1)
      : (a.created_at < b.created_at ? 1 : -1))
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // 6) 페이지 행의 품목 수·상담자 (첫 품목 channel)
  const itemInfo = new Map<string, { count: number; channel: string | null }>()
  if (pageRows.length) {
    const { data } = await admin.from('erp_order_items')
      .select('order_id, channel, line_no')
      .in('order_id', pageRows.map(r => r.id))
      .order('line_no')
    for (const it of data ?? []) {
      const cur = itemInfo.get(it.order_id as string)
      if (cur) cur.count += 1
      else itemInfo.set(it.order_id as string, { count: 1, channel: (it.channel as string) ?? null })
    }
  }

  return NextResponse.json({
    rows: pageRows.map(o => ({
      ...o,
      total_amount: o.total_amount ?? 0,
      outstanding_amount: o.outstanding_amount ?? 0,
      source: o.source ?? 'upload',
      item_count: itemInfo.get(o.id)?.count ?? 0,
      channel: itemInfo.get(o.id)?.channel ?? null,
      is_prepay: prepayIds.has(o.id),
      has_invoice: invoiceIds.has(o.id),
    })),
    kpi,
    page,
    per: PER_PAGE,
    total_pages: totalPages,
    role: me.role,
  })
}
