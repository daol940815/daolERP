import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { TAX_INVOICE_SELECT } from '@/lib/tax-invoice-payments.server'

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

  return NextResponse.json({ data: result.data })
}

// DELETE /api/tax-invoices — body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const { ids } = await req.json() as { ids: string[] }

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: '삭제할 항목을 선택하세요.' }, { status: 400 })
  }

  const { error } = await admin.from('tax_invoices').delete().in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, deleted: ids.length })
}
