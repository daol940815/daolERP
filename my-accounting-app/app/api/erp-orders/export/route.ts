import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'
import { computeOrderDeliveryStatus, ORDER_DELIVERY_STATUS_LABEL } from '@/lib/erp-delivery-status'
import type { ErpOrderItem } from '@/types/erp'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  collected: '수금완료',
  outstanding: '미수금',
  in_progress: '수금진행중',
}

// GET /api/erp-orders/export
// 현재 필터 기준으로 ERP 주문내역을 XLSX로 내보내기
// Query params: from, to, status, view, q
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const from   = searchParams.get('from')
  const to     = searchParams.get('to')
  const status = searchParams.get('status')
  const view   = searchParams.get('view') ?? 'all'
  const q      = searchParams.get('q')?.trim()

  let viewIds: string[] | null = null
  if (view === 'vip' || view === 'prepayment') {
    const flagCol = view === 'vip' ? 'is_vip' : 'is_prepayment'
    const { data: flagged, error: fe } = await admin
      .from('erp_order_items')
      .select('order_id')
      .eq(flagCol, true)
      .limit(10000)
    if (fe) return NextResponse.json({ error: fe.message }, { status: 500 })
    viewIds = Array.from(new Set((flagged ?? []).map(r => r.order_id as string)))
    if (!viewIds.length) viewIds = ['__none__']
  }

  let query = admin
    .from('erp_orders')
    .select('*')
    .order('order_date', { ascending: false })
    .order('order_no')
    .limit(50000)
  if (from)                       query = query.gte('order_date', from)
  if (to)                         query = query.lte('order_date', to)
  if (status && status !== 'all') query = query.eq('collect_status', status)
  if (q) query = query.or(`order_no.ilike.%${q}%,bank_name.ilike.%${q}%,branch_name.ilike.%${q}%`)
  if (viewIds) query = query.in('id', viewIds)

  const { data: orders, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 품목 일괄 로드 (배송상태 집계용)
  const orderIds = (orders ?? []).map(o => o.id as string)
  let items: ErpOrderItem[] = []
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data: chunk, error: ie } = await admin
      .from('erp_order_items')
      .select('*')
      .in('order_id', orderIds.slice(i, i + 200))
    if (ie) return NextResponse.json({ error: ie.message }, { status: 500 })
    items = items.concat((chunk ?? []) as ErpOrderItem[])
  }
  const itemsByOrder = new Map<string, ErpOrderItem[]>()
  for (const it of items) {
    const list = itemsByOrder.get(it.order_id) ?? []
    list.push(it)
    itemsByOrder.set(it.order_id, list)
  }

  const rows = (orders ?? []).map(o => {
    const deliveryStatus = computeOrderDeliveryStatus(itemsByOrder.get(o.id as string) ?? [])
    return {
      '주문일':   o.order_date,
      '주문번호': o.order_no,
      '은행':     o.bank_name ?? '',
      '지점':     o.branch_name ?? '',
      '담당자':   o.manager_name ?? '',
      '총금액':   o.total_amount ?? 0,
      '미수금':   o.outstanding_amount ?? 0,
      '수금상태': STATUS_LABEL[o.collect_status as string] ?? o.collect_status,
      '배송상태': deliveryStatus ? ORDER_DELIVERY_STATUS_LABEL[deliveryStatus].text : '',
      '메모':     o.memo ?? '',
    }
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 12 }, // 주문일
    { wch: 16 }, // 주문번호
    { wch: 14 }, // 은행
    { wch: 14 }, // 지점
    { wch: 12 }, // 담당자
    { wch: 14 }, // 총금액
    { wch: 14 }, // 미수금
    { wch: 10 }, // 수금상태
    { wch: 10 }, // 배송상태
    { wch: 30 }, // 메모
  ]
  XLSX.utils.book_append_sheet(wb, ws, 'ERP 주문내역')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array
  const today = new Date().toISOString().slice(0, 10)

  return new Response(buf.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`ERP_주문내역_${today}`)}.xlsx`,
    },
  })
}
