import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import type { VendorStatusRow } from '@/types/report'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UNASSIGNED_KEY = '__unassigned__'

const DIRECTION_META: Record<string, {
  sheetName: string; billedLabel: string; doneLabel: string; remainingLabel: string; doneCountLabel: string
}> = {
  sales: {
    sheetName: '매출처_수금현황',
    billedLabel: '청구합계',
    doneLabel: '수금완료',
    remainingLabel: '미수금잔액',
    doneCountLabel: '수금완료건수',
  },
  purchase: {
    sheetName: '매입처_결제현황',
    billedLabel: '청구합계',
    doneLabel: '지급완료',
    remainingLabel: '미지급잔액',
    doneCountLabel: '지급완료건수',
  },
}

// GET /api/reports/vendor-status/export?direction=sales|purchase&from=&to=
// 거래처별 세금계산서 발행 합계 대비 입금/출금 확인 현황을 엑셀로 다운로드
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

  const meta = DIRECTION_META[direction]

  const sheetRows = rows.map(r => ({
    '거래처':           r.vendor_name,
    '사업자번호':       r.biz_number ?? '',
    '청구건수':         r.count,
    [meta.billedLabel]:    r.total_amount,
    [meta.doneLabel]:      r.matched_amount,
    [meta.remainingLabel]: r.remaining,
    [meta.doneCountLabel]: r.matched_count,
  }))

  sheetRows.push({
    '거래처':           '합계',
    '사업자번호':       '',
    '청구건수':         rows.reduce((s, r) => s + r.count, 0),
    [meta.billedLabel]:    rows.reduce((s, r) => s + r.total_amount, 0),
    [meta.doneLabel]:      rows.reduce((s, r) => s + r.matched_amount, 0),
    [meta.remainingLabel]: rows.reduce((s, r) => s + r.remaining, 0),
    [meta.doneCountLabel]: rows.reduce((s, r) => s + r.matched_count, 0),
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows)
  ws['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws, meta.sheetName)

  const buf     = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today   = new Date().toISOString().slice(0, 10)
  const filename = `${meta.sheetName}_${today}`

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`,
    },
  })
}
