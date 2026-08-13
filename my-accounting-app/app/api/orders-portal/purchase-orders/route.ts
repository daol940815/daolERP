import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { PO_MIGRATION_HINT } from '@/lib/purchase-orders'

export const dynamic = 'force-dynamic'

// 발주서 이력 (3단계) — 기간·상태·검색 필터 + KPI. 전 직원 사용 가능
// (2026-08-13 사용자 결정: 매입가 전 직원 공개).
// 대금결제 축: 발주서의 매입처 별칭 payment_term(선입금/월정산)을 함께 표시 —
// 실제 정산은 기존 매입처 정산 화면과 같은 축이므로 별도 상태를 만들지 않는다.
//
// GET ?from=&to=&status=all|unsent|sent|canceled&q=

// 조인 결과는 클라이언트 타입 추론상 배열일 수 있어 one()으로 정규화
type OrderJoin = { order_no: string | null; order_date: string; bank_name: string | null; branch_name: string | null; staff_name: string | null }
interface PoRow {
  id: string
  po_no: string
  order_id: string
  vendor_name: string
  total_amount: number
  email_to: string | null
  send_method: string | null
  sent_at: string | null
  send_error: string | null
  status: string
  created_at: string
  order: OrderJoin | OrderJoin[] | null
  sender: { name: string } | { name: string }[] | null
  alias: { payment_term: string | null } | { payment_term: string | null }[] | null
}
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

const kstDate = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  const status = sp.get('status') ?? 'all'
  const q = (sp.get('q') ?? '').trim().toLowerCase()

  const base = await fetchAllRows<PoRow>((pf, pt) => {
    let query = admin.from('erp_purchase_orders')
      .select('id, po_no, order_id, vendor_name, total_amount, email_to, send_method, sent_at, send_error, status, created_at, order:erp_orders(order_no, order_date, bank_name, branch_name, staff_name), sender:employees!erp_purchase_orders_sent_by_fkey(name), alias:erp_vendor_aliases(payment_term)')
    // 발주일(KST) 기준 기간 — created_at은 UTC라 여유 1일을 두고 메모리에서 재필터
    if (from) query = query.gte('created_at', `${from}T00:00:00+09:00`)
    if (to) query = query.lte('created_at', `${to}T23:59:59+09:00`)
    return query.order('created_at', { ascending: false }).range(pf, pt)
  })
  if ('error' in base) {
    const missing = /relation|erp_purchase_orders|does not exist/i.test(base.error)
    return NextResponse.json({ error: missing ? PO_MIGRATION_HINT : base.error }, { status: 500 })
  }

  const rows = base.data
    .map(p => {
      const order = one(p.order)
      return {
        id: p.id,
        po_no: p.po_no,
        order_id: p.order_id,
        vendor_name: p.vendor_name,
        total_amount: p.total_amount ?? 0,
        email_to: p.email_to,
        send_method: p.send_method,
        sent_at: p.sent_at,
        send_error: p.send_error,
        status: p.status,
        created_at: p.created_at,
        po_date: kstDate(p.created_at),
        order_no: order?.order_no ?? null,
        order_date: order?.order_date ?? null,
        customer: [order?.bank_name, order?.branch_name].filter(Boolean).join(' ') || null,
        staff_name: order?.staff_name ?? null,
        sender_name: one(p.sender)?.name ?? null,
        payment_term: one(p.alias)?.payment_term ?? null,
      }
    })
    .filter(r => {
      if (from && r.po_date < from) return false
      if (to && r.po_date > to) return false
      if (status === 'unsent' && (r.status !== 'active' || r.sent_at)) return false
      if (status === 'sent' && (r.status !== 'active' || !r.sent_at)) return false
      if (status === 'canceled' && r.status !== 'canceled') return false
      if (q) {
        const hay = [r.po_no, r.vendor_name, r.order_no, r.customer, r.staff_name]
          .map(v => (v ?? '').toLowerCase())
        if (!hay.some(v => v.includes(q))) return false
      }
      return true
    })

  const active = rows.filter(r => r.status === 'active')
  return NextResponse.json({
    rows,
    kpi: {
      count: rows.length,
      total: active.reduce((s, r) => s + r.total_amount, 0),
      unsent_cnt: active.filter(r => !r.sent_at).length,
      sent_cnt: active.filter(r => !!r.sent_at).length,
      canceled_cnt: rows.filter(r => r.status === 'canceled').length,
    },
  })
}
