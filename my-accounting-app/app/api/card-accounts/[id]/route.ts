import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// PATCH /api/card-accounts/[id] — 별칭 수정 (빈 값이면 별칭 해제)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { alias?: string | null }

  if (!('alias' in body)) {
    return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 })
  }
  const alias = typeof body.alias === 'string' ? body.alias.trim() || null : null

  const { data, error } = await admin
    .from('card_accounts')
    .update({ alias })
    .eq('id', params.id)
    .select('id, card_company, card_number, alias')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
