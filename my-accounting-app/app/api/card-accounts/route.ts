import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// GET /api/card-accounts — 활성 카드계좌 목록 (카드사_카드번호)
export async function GET() {
  const admin = createAdminClient()
  const result = await fetchAllRows<{ id: string; card_company: string; card_number: string; alias: string | null; is_active: boolean }>((f, t) =>
    admin
      .from('card_accounts')
      .select('id, card_company, card_number, alias, is_active')
      .eq('is_active', true)
      .order('card_company')
      .order('card_number')
      .range(f, t),
  )
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const data = result.data.map(a => ({
    ...a,
    label: a.alias?.trim() || `${a.card_company}_${a.card_number}`,
  }))
  return NextResponse.json({ data })
}
