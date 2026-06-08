import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

const TAX_INVOICE_FIELDS = `
  id, approval_number, issue_date, direction, tax_type,
  vendor_id, counterparty_name, counterparty_biz_number,
  supply_amount, tax_amount, total_amount, item_name, note,
  matched_transaction_id, payment_status, payment_memo,
  created_at, updated_at
`

// PATCH /api/tax-invoices/:id
// 허용 필드: vendor_id, matched_transaction_id, payment_status, payment_memo
// (입금/출금 확인 여부는 자동 매칭 외에도 수동으로 변경 가능)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json() as {
    vendor_id?: string | null
    matched_transaction_id?: string | null
    payment_status?: 'matched' | 'unmatched'
    payment_memo?: string | null
  }

  const updates: Record<string, unknown> = {}
  if ('vendor_id' in body)               updates.vendor_id              = body.vendor_id
  if ('matched_transaction_id' in body)  updates.matched_transaction_id = body.matched_transaction_id
  if ('payment_status' in body)          updates.payment_status         = body.payment_status
  if ('payment_memo' in body)            updates.payment_memo           = body.payment_memo?.trim() || null

  // 매칭 거래내역을 해제하면 결제 확인 상태도 자동으로 미확인으로 되돌림 (명시적으로 지정하지 않은 경우)
  if ('matched_transaction_id' in body && body.matched_transaction_id == null && !('payment_status' in body)) {
    updates.payment_status = 'unmatched'
  }
  // 매칭 거래내역을 새로 지정하면 결제 확인 상태도 자동으로 확인됨으로 전환 (명시적으로 지정하지 않은 경우)
  if ('matched_transaction_id' in body && body.matched_transaction_id != null && !('payment_status' in body)) {
    updates.payment_status = 'matched'
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: '업데이트할 항목이 없습니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('tax_invoices')
    .update(updates)
    .eq('id', id)
    .select(TAX_INVOICE_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
