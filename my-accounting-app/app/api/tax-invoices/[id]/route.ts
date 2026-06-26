import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { TAX_INVOICE_SELECT } from '@/lib/tax-invoice-payments.server'
import { syncTaxInvoiceJournal } from '@/lib/journal/tax-invoice-posting'

// PATCH /api/tax-invoices/:id
// 허용 필드: vendor_id, payment_status, payment_memo, confirmed_account_id
// (거래내역 연결/해제는 /api/tax-invoices/:id/payments 에서 처리 — 분할/합산 결제 추적을 위해 분리됨)
// payment_status는 거래내역 연결과 무관하게 수동으로 확인/미확인 전환할 때 사용 (예: 현금결제 등)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json() as {
    vendor_id?: string | null
    payment_status?: 'matched' | 'unmatched'
    payment_memo?: string | null
    confirmed_account_id?: string | null
  }

  const updates: Record<string, unknown> = {}
  if ('vendor_id' in body)               updates.vendor_id              = body.vendor_id
  if ('payment_status' in body)          updates.payment_status         = body.payment_status
  if ('payment_memo' in body)            updates.payment_memo           = body.payment_memo?.trim() || null
  if ('confirmed_account_id' in body)    updates.confirmed_account_id   = body.confirmed_account_id

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: '업데이트할 항목이 없습니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('tax_invoices')
    .update(updates)
    .eq('id', id)
    .select(TAX_INVOICE_SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 분개 동기화 — 계정과목·거래처가 분개에 영향을 주므로 변경 시 재전기(멱등)
  if ('confirmed_account_id' in updates || 'vendor_id' in updates) {
    const jr = await syncTaxInvoiceJournal(admin, id)
    if ('error' in jr) return NextResponse.json({ error: `분개 전기 실패: ${jr.error}` }, { status: 500 })
  }

  return NextResponse.json({ data })
}
