import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

// DELETE /api/bank-accounts/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  // 삭제 시 관련 transactions.bank_account_id 는 ON DELETE SET NULL 로 자동 처리
  const { error } = await admin
    .from('bank_accounts')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
