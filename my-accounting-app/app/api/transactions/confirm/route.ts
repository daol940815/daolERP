import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase-server'
import { syncTransactionJournal } from '@/lib/journal/bank-posting'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/transactions/confirm
// body: { ids: string[], confirm: boolean }
//  - confirm=true : 다중 일괄 확정(status=confirmed) + 분개 자동 전기
//  - confirm=false: 다중 일괄 확정 해제(status=reviewed) + 분개 취소
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { ids?: string[]; confirm?: boolean }
  const ids = Array.isArray(body.ids) ? body.ids : []
  const confirm = body.confirm !== false
  if (!ids.length) return NextResponse.json({ error: '선택된 거래가 없습니다.' }, { status: 400 })

  let userId: string | null = null
  try {
    const supa = await createClient()
    const { data: u } = await supa.auth.getUser()
    userId = u.user?.id ?? null
  } catch { /* 세션 없으면 null */ }

  // 대상 조회 (확정엔 계정과목 필수)
  const { data: txs, error } = await admin
    .from('transactions')
    .select('id, confirmed_account_id, status, transfer_pair_id')
    .in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let done = 0
  const skipped: { id: string; reason: string }[] = []
  const errors: { id: string; error: string }[] = []

  for (const tx of txs ?? []) {
    if (confirm) {
      if (!tx.confirmed_account_id) { skipped.push({ id: tx.id, reason: '계정과목 미지정' }); continue }
      if (tx.transfer_pair_id)      { skipped.push({ id: tx.id, reason: '계좌간 이체(전기 대상 아님)' }); continue }
      const update: Record<string, unknown> = { status: 'confirmed' }
      if (tx.status !== 'confirmed') { update.confirmed_at = new Date().toISOString(); update.confirmed_by = userId }
      const { error: ue } = await admin.from('transactions').update(update).eq('id', tx.id)
      if (ue) { errors.push({ id: tx.id, error: ue.message }); continue }
    } else {
      const { error: ue } = await admin.from('transactions').update({ status: 'reviewed' }).eq('id', tx.id)
      if (ue) { errors.push({ id: tx.id, error: ue.message }); continue }
    }
    const jr = await syncTransactionJournal(admin, tx.id)
    if ('error' in jr) { errors.push({ id: tx.id, error: jr.error }); continue }
    done++
  }

  return NextResponse.json({
    [confirm ? 'confirmed' : 'unconfirmed']: done,
    skipped,
    errors,
    requested: ids.length,
  })
}
