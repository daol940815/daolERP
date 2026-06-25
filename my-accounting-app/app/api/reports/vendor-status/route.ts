import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import type { VendorStatusRow } from '@/types/report'

export const dynamic = 'force-dynamic'

const UNASSIGNED_KEY = '__unassigned__'

// GET /api/reports/vendor-status?direction=sales|purchase&from=&to=
// 거래처별 세금계산서 발행 합계 대비 입금/출금 확인 현황 집계
// (매출처 수금현황 / 매입처 대금결제현황 화면에서 사용)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction = searchParams.get('direction')
  const from      = searchParams.get('from')
  const to        = searchParams.get('to')

  if (direction !== 'sales' && direction !== 'purchase') {
    return NextResponse.json({ error: 'direction은 sales 또는 purchase 여야 합니다.' }, { status: 400 })
  }

  const invoicesResult = await fetchAllRows<{ vendor_id: string | null; total_amount: number | null; payment_status: string | null }>((rFrom, rTo) => {
    let query = admin
      .from('tax_invoices')
      .select('vendor_id, total_amount, payment_status')
      .eq('direction', direction)
    if (from) query = query.gte('issue_date', from)
    if (to)   query = query.lte('issue_date', to)
    return query.range(rFrom, rTo)
  })
  if ('error' in invoicesResult) return NextResponse.json({ error: invoicesResult.error }, { status: 500 })
  const invoices = invoicesResult.data

  const groups = new Map<string, { count: number; total: number; matchedCount: number; matchedAmount: number }>()
  for (const inv of invoices) {
    const key = (inv.vendor_id as string | null) ?? UNASSIGNED_KEY
    const g = groups.get(key) ?? { count: 0, total: 0, matchedCount: 0, matchedAmount: 0 }
    g.count += 1
    g.total += (inv.total_amount as number) || 0
    if (inv.payment_status === 'matched') {
      g.matchedCount  += 1
      g.matchedAmount += (inv.total_amount as number) || 0
    }
    groups.set(key, g)
  }

  const vendorIds = Array.from(groups.keys()).filter(k => k !== UNASSIGNED_KEY)
  const { data: vendors } = vendorIds.length
    ? await admin.from('vendors').select('id, name, biz_number').in('id', vendorIds)
    : { data: [] }
  const vendorMap = new Map((vendors ?? []).map(v => [v.id as string, v]))

  const rows: VendorStatusRow[] = Array.from(groups.entries()).map(([key, g]) => {
    const vendor = key === UNASSIGNED_KEY ? null : vendorMap.get(key)
    return {
      vendor_id:      key === UNASSIGNED_KEY ? null : key,
      vendor_name:    vendor?.name ?? '거래처 미지정',
      biz_number:     (vendor?.biz_number as string | null) ?? null,
      count:          g.count,
      total_amount:   g.total,
      matched_count:  g.matchedCount,
      matched_amount: g.matchedAmount,
      remaining:      g.total - g.matchedAmount,
    }
  })

  rows.sort((a, b) => b.remaining - a.remaining || b.total_amount - a.total_amount)

  return NextResponse.json({ data: rows })
}
