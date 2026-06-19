import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { syncTransactionPaymentEntry } from '@/lib/vendor-ledger'

// PATCH /api/transactions/[id]
// 허용 필드: confirmed_account_id, memo, status, vendor_id, suggested_side
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = createAdminClient()
  const body = await req.json()

  const ALLOWED = ['confirmed_account_id', 'memo', 'status', 'vendor_id', 'suggested_side']
  const updates: Record<string, unknown> = {}

  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key]
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: '업데이트할 항목이 없습니다.' }, { status: 400 })
  }

  // 계정과목 지정 시 자동으로 reviewed 상태로 전환
  if ('confirmed_account_id' in updates && !('status' in updates)) {
    updates.status = updates.confirmed_account_id ? 'reviewed' : 'pending'
  }

  let prevVendorId: string | null = null
  if ('vendor_id' in updates) {
    const { data: before, error: beforeErr } = await admin
      .from('transactions')
      .select('vendor_id')
      .eq('id', params.id)
      .single()
    if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 })
    prevVendorId = before.vendor_id as string | null
  }

  const { data, error } = await admin
    .from('transactions')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 거래처가 지정/변경/해제된 출금 거래는 정산 원장의 입금 항목과 동기화한다
  if ('vendor_id' in updates) {
    const sync = await syncTransactionPaymentEntry(admin, {
      transactionId: params.id,
      prevVendorId,
      newVendorId: data.vendor_id as string | null,
      amountOut:   (data.amount_out as number | null) ?? 0,
      txDate:      data.tx_date as string,
      description: data.description as string | null,
    })
    if ('error' in sync) return NextResponse.json({ error: sync.error }, { status: 500 })
  }

  return NextResponse.json(data)
}
