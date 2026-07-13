import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { TAX_INVOICE_SELECT, addInvoicePayment, removeInvoicePayment, clearInvoicePayments } from '@/lib/tax-invoice-payments.server'

export const dynamic = 'force-dynamic'

// GET /api/tax-invoices/:id/payments — 이 계산서에 연결된 결제(거래내역) 내역 목록
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const { data, error } = await admin
    .from('tax_invoice_payments')
    .select(`
      id, amount, transaction_id, created_at,
      transaction:transactions (
        tx_date, description, counterparty_name, amount_in, amount_out, account_alias,
        bank_accounts ( bank_name, account_number, alias )
      )
    `)
    .eq('tax_invoice_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}

// POST /api/tax-invoices/:id/payments — body: { transactionId, amount }
// 거래내역 1건을 지정한 금액만큼 이 계산서에 연결한다. (분할입금/합산입금 공용)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json().catch(() => null) as { transactionId?: string; amount?: number } | null

  if (!body?.transactionId || !body.amount) {
    return NextResponse.json({ error: '거래내역과 연결할 금액이 필요합니다.' }, { status: 400 })
  }

  const result = await addInvoicePayment(admin, id, body.transactionId, body.amount)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const { data, error } = await admin.from('tax_invoices').select(TAX_INVOICE_SELECT).eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}

// DELETE /api/tax-invoices/:id/payments — body: { paymentId? }
// paymentId가 있으면 해당 연결 1건만 해제, 없으면 이 계산서의 연결을 전부 해제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { paymentId?: string }

  if (body.paymentId) await removeInvoicePayment(admin, id, body.paymentId)
  else                 await clearInvoicePayments(admin, id)

  const { data, error } = await admin.from('tax_invoices').select(TAX_INVOICE_SELECT).eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
