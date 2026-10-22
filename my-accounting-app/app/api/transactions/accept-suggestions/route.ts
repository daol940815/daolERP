import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/transactions/accept-suggestions
// body: { ids: string[] }
// 선택한 통장 거래의 **시스템 추천 계정(suggested_account_id)을 그대로 받아들여**
// 확정 계정(confirmed_account_id)으로 복사하고 상태를 '검토완료(reviewed)'로 바꾼다.
//  - 분개는 만들지 않는다 — 전기는 기존 '선택 확정'(/api/transactions/confirm)이 한다.
//  - 이미 계정이 정해진 행(검토완료·확정), 추천이 없는 행, 계좌간 이체 행은 건너뛴다.
//  - 사용자가 행을 골라 누르는 동작이므로 "시스템은 추천, 확정은 사용자" 원칙은 유지된다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { ids?: string[] }
  const ids = (body.ids ?? []).filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: '대상 거래가 없습니다.' }, { status: 400 })

  let accepted = 0
  const skipped = { no_suggestion: 0, already_set: 0, transfer: 0 }
  const errors: { id: string; error: string }[] = []

  // .in()은 URL로 전달되므로 청크로 나눈다
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const { data: rows, error: qe } = await admin
      .from('transactions')
      .select('id, suggested_account_id, confirmed_account_id, status, transfer_pair_id')
      .in('id', chunk)
    if (qe) return NextResponse.json({ error: qe.message }, { status: 500 })

    // 추천 계정이 같은 행끼리 묶어 UPDATE 횟수를 줄인다
    const byAccount = new Map<string, string[]>()
    for (const r of rows ?? []) {
      if (r.transfer_pair_id)                                   { skipped.transfer++; continue }
      if (r.confirmed_account_id || r.status !== 'pending')     { skipped.already_set++; continue }
      if (!r.suggested_account_id)                              { skipped.no_suggestion++; continue }
      const arr = byAccount.get(r.suggested_account_id as string) ?? []
      arr.push(r.id as string)
      byAccount.set(r.suggested_account_id as string, arr)
    }

    for (const [accountId, txIds] of Array.from(byAccount.entries())) {
      const { error } = await admin
        .from('transactions')
        .update({ confirmed_account_id: accountId, status: 'reviewed' })
        .in('id', txIds)
        .is('confirmed_account_id', null)   // 그 사이 다른 사람이 정했으면 덮지 않는다
      if (error) { for (const id of txIds) errors.push({ id, error: error.message }); continue }
      accepted += txIds.length
    }
  }

  return NextResponse.json({ accepted, skipped, errors, requested: ids.length })
}
