import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/erp-matching/order-search?q=주문번호 — 입금 매칭 화면에서 기간 밖 주문을 주문번호로 찾는다 (2026-11-04)
// 반환: 잔액(순매출 − 전체 매칭) 있는 주문. 뷰 v_erp_order_receivable 기준.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 3) return NextResponse.json({ error: '주문번호를 3자 이상 입력하세요.' }, { status: 400 })
  const { data, error } = await admin
    .from('v_erp_order_receivable')
    .select('order_id, order_no, order_date, vendor_id, collect_status, net_sales, matched_all, bank_name, branch_name')
    .ilike('order_no', `%${q}%`)
    .order('order_date', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const vendorIds = Array.from(new Set((data ?? []).map(r => r.vendor_id).filter(Boolean))) as string[]
  const vname = new Map<string, string>()
  if (vendorIds.length) {
    const { data: vs } = await admin.from('vendors').select('id, name').in('id', vendorIds)
    for (const v of vs ?? []) vname.set(v.id as string, v.name as string)
  }
  return NextResponse.json({
    data: (data ?? []).map(r => ({
      id: r.order_id, order_no: r.order_no, order_date: r.order_date, vendor_id: r.vendor_id,
      customer_name: [r.bank_name, r.branch_name].filter(Boolean).join(' ') || (r.vendor_id ? vname.get(r.vendor_id as string) ?? '' : ''),
      collect_status: r.collect_status, net_amount: r.net_sales ?? 0,
      allocated: r.matched_all ?? 0, remaining: Math.max(0, (r.net_sales ?? 0) - (r.matched_all ?? 0)),
    })),
  })
}
