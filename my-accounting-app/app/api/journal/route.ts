import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/journal?from=&to=&sourceType=&q=
// 분개장: 전표(journal_entries) + 라인(차변/대변, 계정·거래처) 목록.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')
  const sourceType = searchParams.get('sourceType')
  const q          = searchParams.get('q')?.trim()

  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('journal_entries')
      .select(`
        id, entry_no, entry_date, description, source_type, source_id, entry_type,
        journal_lines ( side, amount, note, accounts ( code, name ), vendors ( name ) )
      `)
      .order('entry_date', { ascending: false })
      .order('entry_no', { ascending: false })
    if (from) query = query.gte('entry_date', from)
    if (to)   query = query.lte('entry_date', to)
    if (sourceType && sourceType !== 'all') query = query.eq('source_type', sourceType)
    if (q) query = query.or(`entry_no.ilike.%${q}%,description.ilike.%${q}%`)
    return query.range(f, t)
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const entries = result.data
  let totalDebit = 0
  for (const e of entries) {
    for (const l of (e.journal_lines as { side: string; amount: number }[] ?? [])) {
      if (l.side === 'debit') totalDebit += l.amount || 0
    }
  }

  return NextResponse.json({
    data: entries,
    summary: { count: entries.length, total_amount: totalDebit },
  })
}
