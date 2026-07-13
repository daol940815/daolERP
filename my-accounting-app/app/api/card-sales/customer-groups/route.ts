import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/card-sales/customer-groups
// 매출처 미연결 카드매출을 카드번호 단위로 묶고, ERP 주문과의 금액·일자 대응으로
// "이 카드는 어느 매출처인가"를 추천한다. 추천만 — 확정(assign-customer)은 사용자.
//
// 추천 근거: 카드 승인액 = ERP 주문 합계(또는 실결제액) & 승인일이 주문일 ±7일.
// 같은 카드의 여러 승인이 같은 매출처(ERP 별칭) 주문과 반복 대응할수록 신뢰가 높다.

const WINDOW_DAYS = 7

export async function GET(_req: NextRequest) {
  const admin = createAdminClient()

  // 미연결 카드매출 (승인만 — 취소는 그룹 통계에서 상쇄)
  const salesResult = await fetchAllRows<{
    id: string; tx_date: string; card_number: string | null; acquirer: string | null
    amount: number | null; transaction_type: string
  }>((f, t) =>
    admin.from('card_sales')
      .select('id, tx_date, card_number, acquirer, amount, transaction_type')
      .is('vendor_id', null)
      .range(f, t))
  if ('error' in salesResult) return NextResponse.json({ error: salesResult.error }, { status: 500 })

  // ERP 주문 (매출처 별칭 포함) — 금액 인덱스 구성
  const ordersResult = await fetchAllRows<{
    id: string; order_date: string; total_amount: number | null
    customer_alias_id: string | null
  }>((f, t) =>
    admin.from('erp_orders')
      .select('id, order_date, total_amount, customer_alias_id')
      .not('customer_alias_id', 'is', null)
      .range(f, t))
  if ('error' in ordersResult) return NextResponse.json({ error: ordersResult.error }, { status: 500 })

  const aliasResult = await fetchAllRows<{ id: string; erp_name: string; vendor_id: string | null }>((f, t) =>
    admin.from('erp_vendor_aliases').select('id, erp_name, vendor_id').eq('alias_type', 'customer').range(f, t))
  if ('error' in aliasResult) return NextResponse.json({ error: aliasResult.error }, { status: 500 })
  const aliasById = new Map(aliasResult.data.map(a => [a.id, a]))

  const vendorIds = Array.from(new Set(aliasResult.data.map(a => a.vendor_id).filter((v): v is string => !!v)))
  const vendorName = new Map<string, string>()
  for (let i = 0; i < vendorIds.length; i += 100) {
    const { data } = await admin.from('vendors').select('id, name').in('id', vendorIds.slice(i, i + 100))
    for (const v of data ?? []) vendorName.set(v.id as string, v.name as string)
  }

  type Order = typeof ordersResult.data[number]
  const ordersByAmount = new Map<number, Order[]>()
  const push = (amt: number | null, o: Order) => {
    if (!amt || amt <= 0) return
    const arr = ordersByAmount.get(amt) ?? []
    arr.push(o)
    ordersByAmount.set(amt, arr)
  }
  for (const o of ordersResult.data) push(o.total_amount, o)

  const dayDiff = (a: string, b: string) =>
    Math.abs(new Date(a.slice(0, 10)).getTime() - new Date(b.slice(0, 10)).getTime()) / 86_400_000

  // 카드번호 그룹
  interface Group {
    card_number: string
    count: number
    net_amount: number
    first_date: string
    last_date: string
    acquirers: Set<string>
    hitsByAlias: Map<string, number>
    totalHits: number
  }
  const groups = new Map<string, Group>()
  for (const s of salesResult.data) {
    const cn = (s.card_number ?? '').trim()
    if (!cn) continue
    let g = groups.get(cn)
    if (!g) {
      g = { card_number: cn, count: 0, net_amount: 0, first_date: s.tx_date, last_date: s.tx_date, acquirers: new Set(), hitsByAlias: new Map(), totalHits: 0 }
      groups.set(cn, g)
    }
    g.count++
    g.net_amount += s.amount ?? 0
    if (s.tx_date < g.first_date) g.first_date = s.tx_date
    if (s.tx_date > g.last_date) g.last_date = s.tx_date
    if (s.acquirer) g.acquirers.add(s.acquirer)

    // 승인 건만 주문 대응 검사
    if (s.transaction_type !== 'approval' || !s.amount || s.amount <= 0) continue
    const cands = (ordersByAmount.get(s.amount) ?? []).filter(o => dayDiff(o.order_date, s.tx_date) <= WINDOW_DAYS)
    // 같은 승인이 여러 주문과 겹치면 신뢰가 낮으므로 유일 대응만 hit으로 센다
    const aliasSet = new Set(cands.map(o => o.customer_alias_id as string))
    if (aliasSet.size === 1) {
      const aliasId = Array.from(aliasSet)[0]
      g.hitsByAlias.set(aliasId, (g.hitsByAlias.get(aliasId) ?? 0) + 1)
      g.totalHits++
    }
  }

  const rows = Array.from(groups.values()).map(g => {
    // 추천: 대응 적중이 가장 많은 별칭 (2위와 겹치면 신뢰 낮음 → 적중수 함께 표기)
    let best: { aliasId: string; hits: number } | null = null
    for (const [aliasId, hits] of Array.from(g.hitsByAlias.entries())) {
      if (!best || hits > best.hits) best = { aliasId, hits }
    }
    const alias = best ? aliasById.get(best.aliasId) : null
    return {
      card_number: g.card_number,
      count: g.count,
      net_amount: g.net_amount,
      first_date: g.first_date,
      last_date: g.last_date,
      acquirers: Array.from(g.acquirers),
      suggestion: alias ? {
        alias_id: alias.id,
        alias_name: alias.erp_name,
        vendor_id: alias.vendor_id,
        vendor_name: alias.vendor_id ? (vendorName.get(alias.vendor_id) ?? null) : null,
        hits: best!.hits,
        total_hits: g.totalHits,
      } : null,
    }
  })

  // 추천 있는 것 → 승인액 큰 것 순
  rows.sort((a, b) => (b.suggestion ? 1 : 0) - (a.suggestion ? 1 : 0) || b.net_amount - a.net_amount)

  return NextResponse.json({
    groups: rows,
    summary: {
      card_numbers: rows.length,
      with_suggestion: rows.filter(r => r.suggestion).length,
      linkable_now: rows.filter(r => r.suggestion?.vendor_id).length,
      total_net: rows.reduce((s, r) => s + r.net_amount, 0),
    },
  })
}
