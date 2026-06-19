import type { SupabaseClient } from '@supabase/supabase-js'

// 목록/상세 API에서 공통으로 사용하는 세금계산서 select — 결제 연결 내역(payments)을
// 함께 내려줘서 한 계산서에 여러 거래내역이 부분금액으로 연결된 경우도 화면에서 바로 표현한다.
export const TAX_INVOICE_SELECT = `
  id, approval_number, issue_date, issued_date, direction, tax_type,
  vendor_id, counterparty_name, counterparty_biz_number,
  supply_amount, tax_amount, total_amount, item_name, note,
  matched_transaction_id, payment_status, payment_memo,
  confirmed_account_id,
  created_at, updated_at,
  matched_transaction:transactions!matched_transaction_id (
    tx_date, amount_in, amount_out, account_alias,
    bank_accounts ( bank_name, account_number, alias )
  ),
  payments:tax_invoice_payments (
    id, amount, transaction_id, created_at,
    transaction:transactions (
      tx_date, description, counterparty_name, amount_in, amount_out, account_alias,
      bank_accounts ( bank_name, account_number, alias )
    )
  )
`

type Admin = SupabaseClient

// 결제 연결 내역 합계로 payment_status·matched_transaction_id(최근 연결 거래, 표시용)를 재계산
export async function recalcInvoiceStatus(admin: Admin, invoiceId: string) {
  const { data: invoice } = await admin
    .from('tax_invoices')
    .select('total_amount')
    .eq('id', invoiceId)
    .single()
  if (!invoice) return

  const { data: payments } = await admin
    .from('tax_invoice_payments')
    .select('transaction_id, amount, created_at')
    .eq('tax_invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  const paidTotal = (payments ?? []).reduce((s, p) => s + (p.amount as number), 0)
  const status = paidTotal >= (invoice.total_amount as number) ? 'matched' : 'unmatched'
  const latestTransactionId = (payments?.[0]?.transaction_id as string | undefined) ?? null

  await admin
    .from('tax_invoices')
    .update({ payment_status: status, matched_transaction_id: latestTransactionId })
    .eq('id', invoiceId)
}

type Result = { ok: true } | { ok: false; error: string }

// 거래내역 1건을 계산서에 지정한 금액만큼 연결 (분할/합산 결제 공용)
// 같은 거래내역이 이미 연결되어 있으면 금액을 갱신한다.
export async function addInvoicePayment(
  admin: Admin, invoiceId: string, transactionId: string, amount: number,
): Promise<Result> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: '연결할 금액은 0보다 커야 합니다.' }
  }

  const { data: invoice } = await admin
    .from('tax_invoices')
    .select('total_amount')
    .eq('id', invoiceId)
    .single()
  if (!invoice) return { ok: false, error: '세금계산서를 찾을 수 없습니다.' }

  const { data: existing } = await admin
    .from('tax_invoice_payments')
    .select('amount, transaction_id')
    .eq('tax_invoice_id', invoiceId)
  const alreadyPaid = (existing ?? [])
    .filter(p => p.transaction_id !== transactionId)
    .reduce((s, p) => s + (p.amount as number), 0)

  const remaining = (invoice.total_amount as number) - alreadyPaid
  if (amount > remaining) {
    return { ok: false, error: `합계금액을 초과합니다. (연결 가능 금액: ${remaining.toLocaleString('ko-KR')}원)` }
  }

  const { error } = await admin
    .from('tax_invoice_payments')
    .upsert({ tax_invoice_id: invoiceId, transaction_id: transactionId, amount }, { onConflict: 'tax_invoice_id,transaction_id' })
  if (error) return { ok: false, error: error.message }

  await recalcInvoiceStatus(admin, invoiceId)
  return { ok: true }
}

export async function removeInvoicePayment(admin: Admin, invoiceId: string, paymentId: string) {
  await admin.from('tax_invoice_payments').delete().eq('id', paymentId).eq('tax_invoice_id', invoiceId)
  await recalcInvoiceStatus(admin, invoiceId)
}

export async function clearInvoicePayments(admin: Admin, invoiceId: string) {
  await admin.from('tax_invoice_payments').delete().eq('tax_invoice_id', invoiceId)
  await recalcInvoiceStatus(admin, invoiceId)
}
