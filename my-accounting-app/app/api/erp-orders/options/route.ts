import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// GET /api/erp-orders/options — 필터 드롭다운용 고유값 (다올직원·상담자)
// 실제 주문 데이터에 존재하는 값 기준, 빈도순
export async function GET() {
  const admin = createAdminClient()

  const [staffR, channelR] = await Promise.all([
    fetchAllRows<{ staff_name: string | null }>((f, t) =>
      admin.from('erp_orders').select('staff_name').not('staff_name', 'is', null).range(f, t)),
    fetchAllRows<{ channel: string | null }>((f, t) =>
      admin.from('erp_order_items').select('channel').not('channel', 'is', null).range(f, t)),
  ])
  if ('error' in staffR) return NextResponse.json({ error: staffR.error }, { status: 500 })
  if ('error' in channelR) return NextResponse.json({ error: channelR.error }, { status: 500 })

  const count = (rows: { [k: string]: string | null }[], key: string) => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const v = (r[key] ?? '').trim()
      if (!v) continue
      m.set(v, (m.get(v) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([v]) => v)
  }

  return NextResponse.json({
    staff: count(staffR.data as { [k: string]: string | null }[], 'staff_name'),
    channels: count(channelR.data as { [k: string]: string | null }[], 'channel'),
  })
}
