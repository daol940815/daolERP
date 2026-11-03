import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { syncTaxInvoiceJournal } from '@/lib/journal/tax-invoice-posting'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 계정은 있는데 분개가 없는 계산서 — 업로드 자동 분류(422 이전)의 흔적. 분류 탭의 "분개 누락 동기화"가 쓴다.
//   GET  /api/tax-invoices/sync-journals?direction=  → 건수·합계만
//   POST /api/tax-invoices/sync-journals { direction? } → 전기(멱등)
async function findMissing(admin: ReturnType<typeof createAdminClient>, direction: string | null) {
  const invRes = await fetchAllRows<{ id: string; total_amount: number | null }>((f, t) => {
    let q = admin.from('tax_invoices').select('id, total_amount')
      .not('confirmed_account_id', 'is', null).neq('total_amount', 0)
    if (direction === 'sales' || direction === 'purchase') q = q.eq('direction', direction)
    return q.range(f, t)
  })
  if ('error' in invRes) return { error: invRes.error }
  const posted = await fetchAllRows<{ source_id: string }>((f, t) =>
    admin.from('journal_entries').select('source_id').eq('source_type', 'tax_invoice').range(f, t))
  if ('error' in posted) return { error: posted.error }
  const has = new Set(posted.data.map(p => p.source_id))
  const missing = invRes.data.filter(i => !has.has(i.id))
  return { missing, total: missing.reduce((s, i) => s + (i.total_amount ?? 0), 0) }
}

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const direction = new URL(req.url).searchParams.get('direction')
  const r = await findMissing(admin, direction)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ missing: r.missing.length, total: r.total })
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { direction?: string }
  const r = await findMissing(admin, body.direction ?? null)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  let posted = 0
  const errors: { id: string; error: string }[] = []
  for (const inv of r.missing) {
    const jr = await syncTaxInvoiceJournal(admin, inv.id)
    if ('error' in jr) errors.push({ id: inv.id, error: jr.error })
    else posted++
  }
  return NextResponse.json({ targets: r.missing.length, posted, failed: errors.length, errors: errors.slice(0, 10) })
}
