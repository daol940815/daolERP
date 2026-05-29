import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

// GET /api/transactions?status=all&from=YYYY-MM-DD&to=YYYY-MM-DD&source=all&limit=1000
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const status        = searchParams.get('status') ?? 'all'
  const from          = searchParams.get('from')
  const to            = searchParams.get('to')
  const source        = searchParams.get('source') ?? 'all'
  const bankAccountId = searchParams.get('bankAccountId')
  const limit         = Math.min(parseInt(searchParams.get('limit') ?? '1000'), 5000)

  let query = admin
    .from('transactions')
    .select(
      `id, tx_date, description, amount_in, amount_out, balance,
       source, account_alias, bank_account_id, status, memo, is_journalized,
       suggested_account_id, confirmed_account_id,
       ai_confidence, ai_reason, upload_log_id, created_at`,
    )
    .order('tx_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status !== 'all')  query = query.eq('status', status)
  if (from)              query = query.gte('tx_date', from)
  if (to)                query = query.lte('tx_date', to)
  if (source !== 'all')  query = query.eq('source', source)
  if (bankAccountId)     query = query.eq('bank_account_id', bankAccountId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}
