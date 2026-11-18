import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 최근 배송지 (513 → 2026-11-17 사용자 확정: 기준 = 지점 + 담당자)
// GET ?vendor_id=&contact_id=
//  - 근거: 이 주문처(지점)로 보낸 주문 + 이 주문처 상담일지(숨김 삭제 제외)에 적은 배송지 — 날짜가 최근인 것부터
//  - 같은 담당자의 배송지를 먼저(same_contact), 그다음 같은 지점의 다른 배송지. 같은 배송지는 1번만(횟수 · 최근일 병기)
//  - 화면은 첫 번째를 자동 채움: 같은 담당자 이력이 없으면 같은 지점의 최근 배송지(사용자 결정 — 질문 1 (나))
// 513 미적용이면 빈 목록 + migration_pending. 상담일지 배송지(706) · 숨김 삭제(709) 미적용이면 주문만 본다.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendor_id')
  const contactId = sp.get('contact_id') || null
  if (!vendorId) return NextResponse.json({ data: [] })

  const admin = createAdminClient()
  const SHIP = 'ship_name, ship_phone, ship_zip, ship_addr1, ship_addr2'
  const [orders, consults] = await Promise.all([
    admin.from('erp_orders')
      .select(`order_no, order_date, created_at, contact_id, ${SHIP}`)
      .eq('vendor_id', vendorId).is('canceled_at', null).not('ship_addr1', 'is', null)
      .order('created_at', { ascending: false }).limit(200),
    (async () => {
      const q = (withDeleted: boolean) => {
        let b = admin.from('erp_consultations')
          .select(`consult_date, updated_at, contact_id, ${SHIP}`)
          .eq('vendor_id', vendorId).not('ship_addr1', 'is', null)
        if (withDeleted) b = b.is('deleted_at', null)
        return b.order('updated_at', { ascending: false }).limit(200)
      }
      const r = await q(true)
      if (r.error && /deleted_at/.test(r.error.message)) return q(false)
      return r
    })(),
  ])
  if (orders.error) {
    if (/ship_/.test(orders.error.message)) return NextResponse.json({ data: [], migration_pending: true })
    return NextResponse.json({ error: orders.error.message }, { status: 500 })
  }

  type Src = {
    from: 'order' | 'consult'; no: string | null; date: string; at: string; contact_id: string | null
    ship_name: string | null; ship_phone: string | null; ship_zip: string | null; ship_addr1: string | null; ship_addr2: string | null
  }
  const pick = (o: Record<string, unknown>) => ({
    ship_name: (o.ship_name as string | null) ?? null, ship_phone: (o.ship_phone as string | null) ?? null,
    ship_zip: (o.ship_zip as string | null) ?? null, ship_addr1: (o.ship_addr1 as string | null) ?? null,
    ship_addr2: (o.ship_addr2 as string | null) ?? null,
  })
  const all: Src[] = [
    ...((orders.data ?? []) as Record<string, unknown>[]).map(o => ({
      from: 'order' as const, no: (o.order_no as string | null) ?? null, date: String(o.order_date ?? ''),
      at: String(o.created_at ?? ''), contact_id: (o.contact_id as string | null) ?? null, ...pick(o),
    })),
    ...((consults.error ? [] : consults.data ?? []) as Record<string, unknown>[]).map(c => ({
      from: 'consult' as const, no: null, date: String(c.consult_date ?? ''),
      at: String(c.updated_at ?? ''), contact_id: (c.contact_id as string | null) ?? null, ...pick(c),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  type Addr = Omit<Src, 'contact_id' | 'at'> & { last_order_no: string | null; last_date: string; count: number; same_contact: boolean }
  const byKey = new Map<string, Addr>()
  for (const s of all) {
    const key = [s.ship_name, s.ship_phone, s.ship_zip, s.ship_addr1, s.ship_addr2]
      .map(v => String(v ?? '').replace(/\s+/g, '')).join('|')
    const same = !!contactId && s.contact_id === contactId
    const cur = byKey.get(key)
    if (cur) { cur.count += 1; if (same) cur.same_contact = true; continue }
    byKey.set(key, {
      from: s.from, no: s.no, date: s.date,
      ship_name: s.ship_name, ship_phone: s.ship_phone, ship_zip: s.ship_zip, ship_addr1: s.ship_addr1, ship_addr2: s.ship_addr2,
      last_order_no: s.no, last_date: s.date, count: 1, same_contact: same,
    })
  }
  // 같은 담당자 것을 먼저 — 각 묶음 안에서는 최근순 그대로 (정렬 안정성)
  const list = Array.from(byKey.values())
  const ordered = [...list.filter(a => a.same_contact), ...list.filter(a => !a.same_contact)]
  return NextResponse.json({ data: ordered.slice(0, 8) })
}
