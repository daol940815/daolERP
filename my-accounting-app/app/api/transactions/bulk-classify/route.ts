import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { syncTransactionJournal } from '@/lib/journal/bank-posting'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/transactions/bulk-classify
// body: { transactionIds: string[], accountId: string, vendorId?: string }
// 선택한 통장 거래들의 계정과목을 일괄 확정(status=confirmed)하고 은행 분개를 동기화한다(멱등).
//  - vendorId가 있으면 거래처 미지정 건에만 태깅한다(수동 지정 존중).
//  - 계좌간 이체(transfer_pair_id)는 건드리지 않는다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    transactionIds?: string[]; accountId?: string; vendorId?: string
  }
  const ids = (body.transactionIds ?? []).filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: '대상 거래가 없습니다.' }, { status: 400 })
  if (!body.accountId) return NextResponse.json({ error: '계정과목을 선택하세요.' }, { status: 400 })

  const { data: account } = await admin
    .from('accounts').select('id').eq('id', body.accountId).eq('is_active', true).maybeSingle()
  if (!account) return NextResponse.json({ error: '유효하지 않은 계정과목입니다.' }, { status: 400 })

  let confirmed = 0
  let skippedTransfer = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    // 이체 건 제외 확인
    const { data: rows, error: qe } = await admin
      .from('transactions').select('id, transfer_pair_id, vendor_id').in('id', chunk)
    if (qe) return NextResponse.json({ error: qe.message }, { status: 500 })
    const targets = (rows ?? []).filter(r => !r.transfer_pair_id)
    skippedTransfer += (rows ?? []).length - targets.length

    const targetIds = targets.map(r => r.id as string)
    if (!targetIds.length) continue
    const { error } = await admin
      .from('transactions')
      .update({ confirmed_account_id: body.accountId, status: 'confirmed' })
      .in('id', targetIds)
    if (error) return NextResponse.json({ error: `확정 실패: ${error.message}` }, { status: 500 })
    confirmed += targetIds.length

    // 거래처 태깅 — 비어 있는 건에만
    if (body.vendorId) {
      const untagged = targets.filter(r => !r.vendor_id).map(r => r.id as string)
      if (untagged.length) {
        await admin.from('transactions').update({ vendor_id: body.vendorId }).in('id', untagged)
      }
    }
  }

  // 분개 동기화 (멱등)
  let posted = 0
  const failures: { id: string; error: string }[] = []
  for (const id of ids) {
    const r = await syncTransactionJournal(admin, id)
    if ('error' in r) failures.push({ id, error: r.error })
    else posted++
  }

  return NextResponse.json({
    confirmed, posted, skippedTransfer,
    failed: failures.length, failures: failures.slice(0, 5),
  })
}
