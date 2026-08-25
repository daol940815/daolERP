import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { filterFromSearchParams, loadFilteredOrders } from '@/lib/orders-portal-list'

export const dynamic = 'force-dynamic'

// 주문 현황 목록 (시안 v2) — KPI + 통합 검색(다중 조건 AND·품목 포함) + 칩 필터 + 페이지네이션
// 필터 로직은 엑셀 내보내기와 공용: lib/orders-portal-list.ts
//
// 규모 전제: 주문 ~1만 건 수준이라 필터된 집합을 메모리로 집계한다.
// (10만 단위로 커지면 102 hub_summary_json 패턴의 RPC로 이관 — 트랙 문서 참고)
//
// GET ?q=&from=&to=&collect=&source=&prepay=1&invoice=1&mine=1&page=1

const PER_PAGE = 50

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)

  const result = await loadFilteredOrders(admin, me, filterFromSearchParams(sp))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const { filtered, prepayIds, invoiceIds, poStatus } = result

  // 취소 주문(511)은 금액·수금 KPI에서 제외 — 목록에는 취소 배지로 표시 (상계 효과)
  const active = filtered.filter(o => !o.canceled_at)
  const kpi = {
    count: filtered.length,
    total: active.reduce((s, o) => s + (o.total_amount ?? 0), 0),
    outstanding: active.reduce((s, o) => s + (o.outstanding_amount ?? 0), 0),
    outstanding_cnt: active.filter(o => o.collect_status === 'outstanding').length,
    in_progress_cnt: active.filter(o => o.collect_status === 'in_progress').length,
    canceled_cnt: filtered.filter(o => o.canceled_at).length,
    direct_cnt: filtered.filter(o => o.source === 'direct').length,
    // 발주 상태 (direct 주문만 집계 — 업로드 주문은 대상 아님)
    po_none_cnt: filtered.filter(o => poStatus.get(o.id) === 'none').length,
    po_partial_cnt: filtered.filter(o => poStatus.get(o.id) === 'partial').length,
    po_full_cnt: filtered.filter(o => poStatus.get(o.id) === 'full').length,
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // 페이지 행의 품목 수·상담자 (첫 품목 channel)
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
      po_status: poStatus.get(o.id) ?? null,   // direct 외에는 null
    })),
    kpi,
    page,
    per: PER_PAGE,
    total_pages: totalPages,
    role: me.role,
  })
}
