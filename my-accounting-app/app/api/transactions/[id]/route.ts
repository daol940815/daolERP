import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

// PATCH /api/transactions/[id]
// 허용 필드: confirmed_account_id, memo, status, vendor_id
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = createAdminClient()
  const body = await req.json()

  const ALLOWED = ['confirmed_account_id', 'memo', 'status', 'vendor_id']
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

  const { data, error } = await admin
    .from('transactions')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
