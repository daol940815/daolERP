import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// DELETE /api/vendor-ledger-entries/:id — 잘못 입력한 입금/조정/기초잔액 행 삭제 (관리자 정정용)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const { error } = await admin.from('vendor_ledger_entries').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
