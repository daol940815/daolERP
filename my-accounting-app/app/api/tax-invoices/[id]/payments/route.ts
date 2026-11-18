import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { TAX_INVOICE_SELECT, addInvoicePayment, removeInvoicePayment, clearInvoicePayments } from '@/lib/tax-invoice-payments.server'
import { logLink } from '@/lib/match-log'
import { resolveReason } from '@/lib/payment-reasons'

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
  // 누가 · 언제 붙였는지 이력에 남긴다 (1307)
  await logLink(admin, 'match', [{ source_type: 'invoice_payment', source_id: body.transactionId, amount: body.amount }], '계산서 입금 연결')

  const { data, error } = await admin.from('tax_invoices').select(TAX_INVOICE_SELECT).eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}

// 매출 계산서의 입금 해제는 사유 필수(1307, 2026-11-18) — body.reason { code, text }. 매입 계산서는 받지 않는다(결제처리 범위 밖).
// DELETE /api/tax-invoices/:id/payments — body: { paymentId?, reason? }
// paymentId가 있으면 해당 연결 1건만 해제, 없으면 이 계산서의 연결을 전부 해제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { paymentId?: string; reason?: unknown }
  const { data: inv } = await admin.from('tax_invoices').select('direction').eq('id', id).maybeSingle()
  let reason: { code: string; text: string } | null = null
  if (inv?.direction === 'sales') {
    const rr = resolveReason('release', body.reason)
    if ('error' in rr) return NextResponse.json({ error: rr.error }, { status: 400 })
    reason = rr
  }

  // 주문 수금에서 넘어온 입금은 여기서 풀 수 없다 — 사유를 함께 돌려준다(data 는 최신 상태)
  const r = body.paymentId ? await removeInvoicePayment(admin, id, body.paymentId, reason) : await clearInvoicePayments(admin, id, reason)

  const { data, error } = await admin.from('tax_invoices').select(TAX_INVOICE_SELECT).eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!r.ok) return NextResponse.json({ error: r.error, data }, { status: 409 })
  return NextResponse.json({ data })
}
