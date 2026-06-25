import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/card-expenses?cardAccountId=&from=&to=&status=pending|confirmed&q=
// 법인카드 사용내역 조회 (필터 적용된 전체 — 요약 집계 포함)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const cardAccountId = searchParams.get('cardAccountId')
  const from   = searchParams.get('from')
  const to     = searchParams.get('to')
  const status = searchParams.get('status')
  const q      = searchParams.get('q')?.trim()

  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('card_expenses')
      .select(`
        id, tx_date, tx_time, card_type, merchant_name, merchant_category, merchant_biz_number,
        approved_amount, cancel_amount, settled_amount, statement_status, usage_type,
        classification, classify_status, ai_reason, memo,
        card_account:card_accounts ( card_company, card_number, alias ),
        confirmed:accounts!confirmed_account_id ( code, name ),
        suggested:accounts!suggested_account_id ( code, name )
      `)
      .order('tx_date', { ascending: false })
      .order('tx_time', { ascending: false, nullsFirst: false })
    if (cardAccountId)            query = query.eq('card_account_id', cardAccountId)
    if (from)                     query = query.gte('tx_date', from)
    if (to)                       query = query.lte('tx_date', to)
    if (status === 'pending' || status === 'confirmed') query = query.eq('classify_status', status)
    if (q)                        query = query.ilike('merchant_name', `%${q}%`)
    return query.range(f, t)
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const rows = result.data
  const summary = {
    count: rows.length,
    approved_total: rows.reduce((s, r) => s + ((r.approved_amount as number) || 0), 0),
    pending_count: rows.filter(r => r.classify_status === 'pending').length,
  }
  return NextResponse.json({ data: rows, summary })
}
