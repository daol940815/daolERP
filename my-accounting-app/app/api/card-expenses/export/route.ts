import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STATUS: Record<string, string> = { pending: '미확정', confirmed: '확정' }

// GET /api/card-expenses/export?cardAccountId=&from=&to=&status=&q=
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const cardAccountId = searchParams.get('cardAccountId'); const from = searchParams.get('from')
  const to = searchParams.get('to'); const status = searchParams.get('status'); const q = searchParams.get('q')?.trim()

  const result = await fetchAllRows<Record<string, unknown>>((f, t) => {
    let query = admin
      .from('card_expenses')
      .select(`tx_date, tx_time, merchant_name, merchant_category, merchant_biz_number,
        approved_amount, cancel_amount, settled_amount, usage_type, classification, classify_status, memo,
        card_account:card_accounts ( card_company, card_number ),
        confirmed:accounts!confirmed_account_id ( code, name )`)
      .order('tx_date', { ascending: false })
      .order('tx_time', { ascending: false, nullsFirst: false })
    if (cardAccountId) query = query.eq('card_account_id', cardAccountId)
    if (from) query = query.gte('tx_date', from)
    if (to)   query = query.lte('tx_date', to)
    if (status === 'pending' || status === 'confirmed') query = query.eq('classify_status', status)
    if (q) query = query.ilike('merchant_name', `%${q}%`)
    return query.range(f, t)
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  const rows = result.data.map(r => {
    const ca = r.card_account as { card_company: string | null; card_number: string | null } | null
    const acc = r.confirmed as { code: string | null; name: string } | null
    return {
      '거래일자': r.tx_date, '시간': r.tx_time ?? '',
      '카드사': ca?.card_company ?? '', '카드번호': ca?.card_number ?? '',
      '가맹점': r.merchant_name ?? '', '업종': r.merchant_category ?? '',
      '사업자번호': r.merchant_biz_number ?? '',
      '승인금액': r.approved_amount ?? 0, '취소금액': r.cancel_amount ?? 0, '정산금액': r.settled_amount ?? 0,
      '계정과목': acc ? `${acc.code ?? ''} ${acc.name}`.trim() : '',
      '분류': r.classification ?? '', '상태': STATUS[r.classify_status as string] ?? r.classify_status,
      '메모': r.memo ?? '',
    }
  })
  return xlsxResponse(rows, '법인카드사용내역', [12, 8, 12, 20, 24, 14, 14, 14, 12, 12, 18, 12, 8, 20])
}
