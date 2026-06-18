import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// POST /api/tax-invoices/match-sum
// body: { invoiceIds: string[] }
// 한 거래처가 발행한 계산서 여러 건을 한 번에 입금/출금한 경우를 위해,
// 선택한 계산서들의 합계금액과 정확히 일치하는 거래내역을 후보로 찾는다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as { invoiceIds?: string[] } | null
  const invoiceIds = body?.invoiceIds ?? []

  if (!Array.isArray(invoiceIds) || invoiceIds.length < 2) {
    return NextResponse.json({ error: '계산서를 2건 이상 선택해주세요.' }, { status: 400 })
  }

  const { data: invoices, error: invErr } = await admin
    .from('tax_invoices')
    .select('id, direction, total_amount, issue_date, vendor_id, counterparty_name, counterparty_biz_number')
    .in('id', invoiceIds)

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!invoices || invoices.length !== invoiceIds.length) {
    return NextResponse.json({ error: '일부 계산서를 찾을 수 없습니다.' }, { status: 404 })
  }

  const directions = new Set(invoices.map(i => i.direction))
  if (directions.size > 1) {
    return NextResponse.json({ error: '매출/매입 방향이 같은 계산서만 함께 매칭할 수 있습니다.' }, { status: 400 })
  }
  const vendorIds = new Set(invoices.map(i => i.vendor_id).filter(Boolean))
  if (vendorIds.size > 1) {
    return NextResponse.json({ error: '같은 거래처의 계산서만 함께 매칭할 수 있습니다.' }, { status: 400 })
  }

  const direction = invoices[0].direction as 'sales' | 'purchase'
  const vendorId  = invoices[0].vendor_id as string | null
  const sumAmount = invoices.reduce((s, i) => s + (i.total_amount as number), 0)

  let aliases: string[] = []
  if (vendorId) {
    const { data: vendor } = await admin.from('vendors').select('match_aliases').eq('id', vendorId).single()
    aliases = (vendor?.match_aliases as string[] | null) ?? []
  }

  const amountCol = direction === 'sales' ? 'amount_in' : 'amount_out'
  const { data: amountMatches, error } = await admin
    .from('transactions')
    .select('id, tx_date, description, counterparty_name, amount_in, amount_out, account_alias, vendor_id, confirmed_account_id')
    .eq(amountCol, sumAmount)
    .order('tx_date', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bizDigits = invoices.find(i => i.counterparty_biz_number)?.counterparty_biz_number?.replace(/[^0-9]/g, '') ?? ''
  const names      = Array.from(new Set(invoices.map(i => i.counterparty_name?.trim()).filter(Boolean))) as string[]
  const latestIssueTime = Math.max(...invoices.map(i => new Date(i.issue_date as string).getTime()))

  const scored = (amountMatches ?? []).map(tx => {
    const desc          = (tx.description as string) ?? ''
    const counterparty  = (tx.counterparty_name as string | null) ?? ''
    const haystack       = `${desc} ${counterparty}`
    const haystackDigits = haystack.replace(/[^0-9]/g, '')
    const dayDiff        = Math.abs(new Date(tx.tx_date as string).getTime() - latestIssueTime) / 86_400_000

    let score = 0
    if (vendorId && tx.vendor_id === vendorId)                          score += 3
    if (bizDigits && haystackDigits.includes(bizDigits))                score += 2
    if (names.some(name => haystack.includes(name)))                    score += 2
    if (aliases.some(alias => alias && haystack.includes(alias)))       score += 2
    if (dayDiff <= 31)                                                  score += 1

    return { tx, score, dayDiff }
  })

  scored.sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff)

  return NextResponse.json({ sumAmount, candidates: scored.map(s => s.tx) })
}

// PATCH /api/tax-invoices/match-sum
// body: { invoiceIds: string[], transactionId: string }
// 선택한 계산서 전부를 같은 거래내역 하나에 연결한다 (합계 매칭 확정).
export async function PATCH(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as { invoiceIds?: string[]; transactionId?: string } | null
  const invoiceIds   = body?.invoiceIds ?? []
  const transactionId = body?.transactionId

  if (!Array.isArray(invoiceIds) || invoiceIds.length < 2 || !transactionId) {
    return NextResponse.json({ error: '계산서 목록과 거래내역이 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('tax_invoices')
    .update({ matched_transaction_id: transactionId, payment_status: 'matched' })
    .in('id', invoiceIds)
    .select(`
      id, approval_number, issue_date, direction, tax_type,
      vendor_id, counterparty_name, counterparty_biz_number,
      supply_amount, tax_amount, total_amount, item_name, note,
      matched_transaction_id, payment_status, payment_memo,
      confirmed_account_id,
      created_at, updated_at,
      matched_transaction:transactions!matched_transaction_id (
        tx_date, amount_in, amount_out, account_alias,
        bank_accounts ( bank_name, account_number, alias )
      )
    `)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
