import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SRC: Record<string, string> = { bank: '은행', card: '법인카드', tax_invoice: '세금계산서', manual: '수동' }

// GET /api/journal/export?from=&to=&sourceType=&q=
// 분개장: 전표를 라인(차변/대변) 단위로 펼쳐 XLSX 내보내기.
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from'); const to = searchParams.get('to')
  const sourceType = searchParams.get('sourceType'); const q = searchParams.get('q')?.trim()

  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('journal_entries')
      .select(`entry_no, entry_date, description, source_type,
        journal_lines ( side, amount, note, accounts ( code, name ), vendors ( name ) )`)
      .order('entry_date', { ascending: true })
      .order('entry_no', { ascending: true })
    if (from) query = query.gte('entry_date', from)
    if (to)   query = query.lte('entry_date', to)
    if (sourceType && sourceType !== 'all') query = query.eq('source_type', sourceType)
    if (q) query = query.or(`entry_no.ilike.%${q}%,description.ilike.%${q}%`)
    return query.range(f, t)
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  type L = { side: string; amount: number; note: string | null; accounts: { code: string | null; name: string } | null; vendors: { name: string } | null }
  const rows: Record<string, unknown>[] = []
  for (const e of result.data) {
    const lines = (e.journal_lines as L[] ?? []).slice().sort((a, b) => (a.side === 'debit' ? -1 : 1) - (b.side === 'debit' ? -1 : 1))
    for (const l of lines) {
      rows.push({
        '일자': e.entry_date,
        '전표번호': e.entry_no,
        '출처': SRC[e.source_type as string] ?? e.source_type,
        '적요': e.description ?? '',
        '계정코드': l.accounts?.code ?? '',
        '계정과목': l.accounts?.name ?? '',
        '거래처': l.vendors?.name ?? '',
        '차변': l.side === 'debit' ? l.amount : '',
        '대변': l.side === 'credit' ? l.amount : '',
        '비고': l.note ?? '',
      })
    }
  }

  return xlsxResponse(rows, '분개장', [12, 18, 10, 30, 10, 16, 20, 14, 14, 20])
}
