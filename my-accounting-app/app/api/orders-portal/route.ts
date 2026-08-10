import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// 주문 현황 목록 (시안 v2) — KPI + 통합 검색(품목 포함) + 칩 필터 + 페이지네이션
//
// 규모 전제: 주문 ~1만 건 수준이라 필터된 집합을 메모리로 집계한다.
// (10만 단위로 커지면 102 hub_summary_json 패턴의 RPC로 이관 — 트랙 문서 참고)
//
// GET ?q=&from=&to=&collect=&source=&prepay=1&invoice=1&mine=1&page=1

const PER_PAGE = 50

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

  // 2) 통합 검색 — 주문 필드는 메모리, 상품명·품번·상담자는 품목 테이블 조회
  let itemMatchIds: Set<string> | null = null
  if (q) {
    const pattern = `%${q}%`
    const results = await Promise.all(
      (['item_name', 'item_code', 'channel'] as const).map(col =>
        fetchAllRows<{ order_id: string }>((f, t) =>
          admin.from('erp_order_items').select('order_id').ilike(col, pattern).range(f, t),
        ),
      ),
    )
    itemMatchIds = new Set<string>()
    for (const r of results) {
      if (!('error' in r)) for (const row of r.data) itemMatchIds.add(row.order_id)
    }
  }

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

  const matchText = (o: OrderRow) =>
    [o.order_no, o.bank_name, o.branch_name, o.manager_name, o.staff_name]
      .some(v => (v ?? '').toLowerCase().includes(q))

  const filtered = base.data.filter(o => {
    if (q && !matchText(o) && !itemMatchIds?.has(o.id)) return false
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
