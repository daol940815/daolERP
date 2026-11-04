import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 최근 배송지 (513, 2026-11-04 사용자 확정 — 자동 채움 기준 = 같은 주문처)
// GET ?vendor_id=  → 이 주문처로 보낸 배송지, 최근순 · 같은 배송지는 1번만(횟수·최근일 병기)
// 513 미적용이면 빈 목록 + migration_pending
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const vendorId = new URL(req.url).searchParams.get('vendor_id')
  if (!vendorId) return NextResponse.json({ data: [] })

  const admin = createAdminClient()
  const { data, error } = await admin.from('erp_orders')
    .select('order_no, order_date, created_at, ship_name, ship_phone, ship_zip, ship_addr1, ship_addr2')
    .eq('vendor_id', vendorId).not('ship_addr1', 'is', null)
    .order('created_at', { ascending: false }).limit(200)
  if (error) {
    if (/ship_/.test(error.message)) return NextResponse.json({ data: [], migration_pending: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  type Addr = {
    ship_name: string | null; ship_phone: string | null; ship_zip: string | null
    ship_addr1: string | null; ship_addr2: string | null
    last_order_no: string | null; last_date: string; count: number
  }
  const byKey = new Map<string, Addr>()
  for (const o of data ?? []) {
    const key = [o.ship_name, o.ship_phone, o.ship_zip, o.ship_addr1, o.ship_addr2]
      .map(v => String(v ?? '').replace(/\s+/g, '')).join('|')
    const cur = byKey.get(key)
    if (cur) { cur.count += 1; continue }
    byKey.set(key, {
      ship_name: o.ship_name, ship_phone: o.ship_phone, ship_zip: o.ship_zip,
      ship_addr1: o.ship_addr1, ship_addr2: o.ship_addr2,
      last_order_no: o.order_no as string | null, last_date: String(o.order_date ?? ''), count: 1,
    })
  }
  return NextResponse.json({ data: Array.from(byKey.values()).slice(0, 8) })
}
