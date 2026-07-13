import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase-server'
import { syncTransactionPaymentEntry } from '@/lib/vendor-ledger'
import { syncTransactionJournal } from '@/lib/journal/bank-posting'

// PATCH /api/transactions/[id]
// 허용 필드: confirmed_account_id, memo, status, vendor_id, suggested_side
// 확정(status=confirmed) 시 분개 자동 전기, 해제 시 전기 취소(분개 동기화).
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

  // 변경 전 상태 (감사필드 · 분개 동기화 판단용)
  const { data: before, error: beforeErr } = await admin
    .from('transactions')
    .select('vendor_id, confirmed_account_id, status, account_changed_count')
    .eq('id', params.id)
    .single()
  if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 })
  const prevVendorId = before.vendor_id as string | null

  // 계정과목 지정 시 자동으로 reviewed 상태로 전환(명시 status가 없을 때)
  if ('confirmed_account_id' in updates && !('status' in updates)) {
    updates.status = updates.confirmed_account_id ? 'reviewed' : 'pending'
  }

  // 재분류 감사: 확정계정이 실제로 바뀌고, 직전에도 계정이 있었으면 카운트/직전계정 기록
  if ('confirmed_account_id' in updates
      && updates.confirmed_account_id !== before.confirmed_account_id
      && before.confirmed_account_id) {
    updates.account_changed_count = ((before.account_changed_count as number) ?? 0) + 1
    updates.prev_account_id = before.confirmed_account_id
  }

  // 확정 전이 시 확정자/시각 기록
  const becomingConfirmed = updates.status === 'confirmed' && before.status !== 'confirmed'
  if (becomingConfirmed) {
    updates.confirmed_at = new Date().toISOString()
    let userId: string | null = null
    try {
      const supa = await createClient()
      const { data: u } = await supa.auth.getUser()
      userId = u.user?.id ?? null
    } catch { /* 세션 없으면 null */ }
    updates.confirmed_by = userId
  }

  const { data, error } = await admin
    .from('transactions')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 거래처 변경 시 정산 원장 동기화
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

  // 분개 동기화 (확정→전기 / 해제→취소 / 재분류→재전기)
  if ('status' in updates || 'confirmed_account_id' in updates || 'vendor_id' in updates) {
    const jr = await syncTransactionJournal(admin, params.id)
    if ('error' in jr) return NextResponse.json({ error: `분개 전기 실패: ${jr.error}` }, { status: 500 })
  }

  return NextResponse.json(data)
}
