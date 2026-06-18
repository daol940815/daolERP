import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const TAX_INVOICE_FIELDS = `
  id, approval_number, issue_date, direction, tax_type,
  vendor_id, counterparty_name, counterparty_biz_number,
  supply_amount, tax_amount, total_amount, item_name, note,
  matched_transaction_id, payment_status, payment_memo,
  confirmed_account_id,
  created_at, updated_at,
  matched_transaction:transactions!matched_transaction_id (
    tx_date, amount_in, amount_out, account_alias,
    bank_accounts ( bank_name, account_number, alias )
  )
`

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
  const limit         = Math.min(parseInt(searchParams.get('limit') ?? '2000'), 5000)

  let query = admin
    .from('tax_invoices')
    .select(TAX_INVOICE_FIELDS)
    .order('issue_date', { ascending: false })
    .limit(limit)

  if (direction)     query = query.eq('direction', direction)
  if (taxType)       query = query.eq('tax_type', taxType)
  if (vendorId)      query = query.eq('vendor_id', vendorId)
  if (paymentStatus) query = query.eq('payment_status', paymentStatus)
  if (from)          query = query.gte('issue_date', from)
  if (to)            query = query.lte('issue_date', to)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
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
