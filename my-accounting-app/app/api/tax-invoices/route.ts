import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { TAX_INVOICE_SELECT } from '@/lib/tax-invoice-payments.server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/tax-invoices?direction=sales|purchase&taxType=taxable|exempt
//                       &vendorId=...&paymentStatus=matched|unmatched&from=&to=&limit=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction     = searchParams.get('direction')
  const taxType       = searchParams.get('taxType')
  const vendorId      = searchParams.get('vendorId')
  const paymentStatus = searchParams.get('paymentStatus')
  const from          = searchParams.get('from')
  const to            = searchParams.get('to')

  // 전체 조회(range 페이지네이션) — PostgREST max-rows(1000) 절단 방지: 합계가 1000건에서 잘리지 않도록
  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('tax_invoices')
      .select(TAX_INVOICE_SELECT)
      .order('issue_date', { ascending: false })
    if (direction)     query = query.eq('direction', direction)
    if (taxType)       query = query.eq('tax_type', taxType)
    if (vendorId)      query = query.eq('vendor_id', vendorId)
    if (paymentStatus) query = query.eq('payment_status', paymentStatus)
    if (from)          query = query.gte('issue_date', from)
    if (to)            query = query.lte('issue_date', to)
    return query.range(f, t)
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  // 주문 연결 (2026-11-17) — 매출 계산서가 어느 주문에 연결돼 있는지. 계산서 id → [{ order_id, order_no, amount }]
  // 줄 데이터와 따로 내려 준다(줄은 수정 응답으로 통째로 바뀌므로 연결 정보가 지워지지 않게).
  const order_links: Record<string, { order_id: string; order_no: string | null; amount: number }[]> = {}
  const salesIds = result.data.filter(r => r.direction === 'sales').map(r => r.id as string)
  if (salesIds.length) {
    const links: { tax_invoice_id: string; order_id: string; amount: number }[] = []
    for (let i = 0; i < salesIds.length; i += 150) {
      const { data, error } = await admin.from('erp_order_invoices').select('tax_invoice_id, order_id, amount').in('tax_invoice_id', salesIds.slice(i, i + 150))
      if (error) break   // 067 미적용 등 — 연결 표시만 생략
      links.push(...((data ?? []) as typeof links))
    }
    const orderIds = Array.from(new Set(links.map(l => l.order_id)))
    const orderNo = new Map<string, string | null>()
    for (let i = 0; i < orderIds.length; i += 150) {
      const { data } = await admin.from('erp_orders').select('id, order_no').in('id', orderIds.slice(i, i + 150))
      for (const o of data ?? []) orderNo.set(o.id as string, (o.order_no as string | null) ?? null)
    }
    for (const l of links) (order_links[l.tax_invoice_id] ??= []).push({ order_id: l.order_id, order_no: orderNo.get(l.order_id) ?? null, amount: Number(l.amount ?? 0) })
  }
  // 주문 연결 버튼 — 수금 · 정산 작업 수정 권한자만 (다른 연결 창구와 같음)
  const me = await getCurrentUser()
  return NextResponse.json({ data: result.data, order_links, can_link_order: !!me && can(me, 'collections', 'edit') })
}

// DELETE /api/tax-invoices — body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const { ids } = await req.json() as { ids: string[] }

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: '삭제할 항목을 선택하세요.' }, { status: 400 })
  }

  // 대량 삭제 대비 청크 처리 (.in() URL 길이 한계 회피)
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    // 분개(전기)된 건이면 고아 전표가 남지 않도록 먼저 분개 제거 (source_id는 FK 아님 → 수동 정리)
    const { error: jErr } = await admin
      .from('journal_entries')
      .delete()
      .eq('source_type', 'tax_invoice')
      .in('source_id', chunk)
    if (jErr) return NextResponse.json({ error: `분개 정리 실패: ${jErr.message}` }, { status: 500 })

    const { error } = await admin.from('tax_invoices').delete().in('id', chunk)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: ids.length })
}
