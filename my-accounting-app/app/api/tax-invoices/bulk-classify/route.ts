import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { syncTaxInvoiceJournal } from '@/lib/journal/tax-invoice-posting'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/tax-invoices/bulk-classify
// body: { direction: 'sales'|'purchase', accountId: uuid, taxType?: 'taxable'|'exempt', onlyUnclassified?: boolean(기본 true) }
// 미분류(계정 미지정) 세금계산서를 지정 계정으로 일괄 분류하고 자동 분개한다(멱등).
// 매출은 대부분 매출(4001)로 뻔하므로 일괄 분류에 적합하다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    direction?: 'sales' | 'purchase'
    accountId?: string
    taxType?: 'taxable' | 'exempt'
    onlyUnclassified?: boolean
  }
  if (body.direction !== 'sales' && body.direction !== 'purchase') {
    return NextResponse.json({ error: 'direction(sales|purchase)이 필요합니다.' }, { status: 400 })
  }
  if (!body.accountId) return NextResponse.json({ error: 'accountId가 필요합니다.' }, { status: 400 })
  const onlyUnclassified = body.onlyUnclassified !== false

  // 계정 유효성
  const { data: acc, error: ae } = await admin.from('accounts').select('id').eq('id', body.accountId).single()
  if (ae || !acc) return NextResponse.json({ error: '유효한 계정과목이 아닙니다.' }, { status: 400 })

  // 대상 조회
  const targets = await fetchAllRows<{ id: string }>((f, t) => {
    let q = admin.from('tax_invoices').select('id').eq('direction', body.direction!).neq('total_amount', 0)
    if (onlyUnclassified) q = q.is('confirmed_account_id', null)
    if (body.taxType) q = q.eq('tax_type', body.taxType)
    return q.range(f, t)
  })
  if ('error' in targets) return NextResponse.json({ error: targets.error }, { status: 500 })

  // 일괄 계정 지정
  const ids = targets.data.map(r => r.id)
  if (ids.length === 0) return NextResponse.json({ classified: 0, posted: 0, errors: [] })

  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await admin
      .from('tax_invoices')
      .update({ confirmed_account_id: body.accountId })
      .in('id', ids.slice(i, i + CHUNK))
    if (error) return NextResponse.json({ error: `계정 지정 실패: ${error.message}` }, { status: 500 })
  }

  // 분개 전기(멱등)
  let posted = 0
  const errors: { id: string; error: string }[] = []
  for (const id of ids) {
    const jr = await syncTaxInvoiceJournal(admin, id)
    if ('error' in jr) errors.push({ id, error: jr.error })
    else posted++
  }

  return NextResponse.json({ classified: ids.length, posted, errors })
}
