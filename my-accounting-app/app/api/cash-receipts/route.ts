import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cash-receipts
// Query params: direction, from, to, type, unmatched
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const direction = searchParams.get('direction')
  const from      = searchParams.get('from')
  const to        = searchParams.get('to')
  const type      = searchParams.get('type')
  const unmatched = searchParams.get('unmatched')
  const paymentStatus = searchParams.get('paymentStatus')   // 425: unmatched | partial | matched (매출 발행 건)

  // 전체 조회(range) — PostgREST max-rows(1000) 절단 방지
  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('cash_receipts')
      .select('*')
      .order('tx_date', { ascending: false })
    if (direction)              query = query.eq('direction', direction)
    if (from)                   query = query.gte('tx_date', from)
    if (to)                     query = query.lte('tx_date', to)
    if (type && type !== 'all') query = query.eq('transaction_type', type)
    if (unmatched === 'true')   query = query.is('vendor_id', null)
    if (paymentStatus)          query = query.eq('payment_status', paymentStatus)
    return query.range(f, t)
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  // 425: 매출 발행 건에 통장 입금 연결 내역을 붙인다 (테이블이 없으면 조용히 건너뜀)
  if (direction === 'sales' && result.data.length) {
    type Link = { id: string; cash_receipt_id: string; amount: number; matched_by: string; transaction: { id: string; tx_date: string; description: string | null; counterparty_name: string | null; amount_in: number; account_alias: string | null } | null }
    const ids = result.data.map(r => r.id as string)
    const byReceipt = new Map<string, Link[]>()
    for (let i = 0; i < ids.length; i += 100) {
      const { data: links, error } = await admin
        .from('cash_receipt_payments')
        .select('id, cash_receipt_id, amount, matched_by, transaction:transactions(id, tx_date, description, counterparty_name, amount_in, account_alias)')
        .in('cash_receipt_id', ids.slice(i, i + 100))
      if (error) break
      for (const l of (links ?? []) as unknown as Link[]) byReceipt.set(l.cash_receipt_id, [...(byReceipt.get(l.cash_receipt_id) ?? []), l])
    }
    for (const r of result.data) r.payments = byReceipt.get(r.id as string) ?? []
  }

  return NextResponse.json({ data: result.data })
}

// DELETE /api/cash-receipts — 선택 건 일괄 삭제
// Body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const body  = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids : []

  if (!ids.length) return NextResponse.json({ error: 'ids 필드가 필요합니다.' }, { status: 400 })

  const { data, error } = await admin
    .from('cash_receipts')
    .delete()
    .in('id', ids)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: data?.length ?? 0 })
}
