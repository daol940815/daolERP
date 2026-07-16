import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { TAX_INVOICE_SELECT, addInvoicePayment } from '@/lib/tax-invoice-payments.server'
import { MATCH_RULES, dateRank, isPrepayVendor, lagDays, makeIdentityScorer } from '@/lib/matching-rules'

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
  // 수정(음수) 계산서가 섞이면 순액으로 거래를 찾는다 (예: 319,500 - 297,500 = 22,000 출금)
  const sumAmount = invoices.reduce((s, i) => s + (i.total_amount as number), 0)
  if (sumAmount <= 0) {
    return NextResponse.json(
      { error: '선택한 계산서의 합계가 0원 이하입니다. 전액 취소 상계(합계 0)는 거래 연결 없이 상태 배지 클릭으로 확인 처리하세요.' },
      { status: 400 },
    )
  }

  let aliases: string[] = []
  if (vendorId) {
    const { data: vendor } = await admin.from('vendors').select('match_aliases').eq('id', vendorId).single()
    aliases = (vendor?.match_aliases as string[] | null) ?? []
  }

  const amountCol = direction === 'sales' ? 'amount_in' : 'amount_out'
  const { data: amountMatches, error } = await admin
    .from('transactions')
    .select('id, tx_date, tx_time, description, counterparty_name, amount_in, amount_out, account_alias, vendor_id, confirmed_account_id')
    .eq(amountCol, sumAmount)
    .is('transfer_pair_id', null)
    .order('tx_date', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 이미 다른 계산서에 연결된 거래는 남은 금액이 부족하면 후보에서 제외
  const txIds = (amountMatches ?? []).map(t => t.id as string)
  const usedByTx = new Map<string, number>()
  for (let i = 0; i < txIds.length; i += 100) {
    const { data: pays, error: payErr } = await admin
      .from('tax_invoice_payments')
      .select('transaction_id, amount')
      .in('transaction_id', txIds.slice(i, i + 100))
    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })
    for (const p of pays ?? []) usedByTx.set(p.transaction_id as string, (usedByTx.get(p.transaction_id as string) ?? 0) + (p.amount as number))
  }
  const available = (amountMatches ?? []).filter(tx => {
    const cap = (direction === 'sales' ? tx.amount_in : tx.amount_out) as number | null
    return (cap ?? 0) - (usedByTx.get(tx.id as string) ?? 0) >= sumAmount
  })

  // 여러 장 합계 매칭은 가장 늦게 발행된 계산서를 기준일로 본다 (그 이후에 몰아서 지급)
  const latestIssueDate = invoices.map(i => i.issue_date as string).sort().at(-1) as string
  // 상호명은 계산서마다 표기가 다를 수 있어 스코어러 밖에서 이름 목록으로 검사
  const scoreOf = makeIdentityScorer(
    { vendor_id: vendorId, counterparty_biz_number: invoices.find(i => i.counterparty_biz_number)?.counterparty_biz_number ?? null, counterparty_name: null },
    aliases,
  )
  const names = Array.from(new Set(invoices.map(i => i.counterparty_name?.trim()).filter(Boolean))) as string[]
  const prepayVendor = await isPrepayVendor(admin, vendorId)

  const scored = available.map(tx => {
    const haystack = `${(tx.description as string) ?? ''} ${(tx.counterparty_name as string | null) ?? ''}`
    const lag = lagDays(tx.tx_date as string, latestIssueDate)
    let score = scoreOf(tx)
    if (names.some(name => name && haystack.includes(name))) score += 2
    if (Math.abs(lag) <= MATCH_RULES.SCORE_NEAR_BONUS_DAYS) score += 1
    return { tx, score, lag }
  })

  scored.sort((a, b) =>
    b.score - a.score
    || dateRank(a.lag, prepayVendor) - dateRank(b.lag, prepayVendor)
    || Math.abs(a.lag) - Math.abs(b.lag))

  return NextResponse.json({ sumAmount, candidates: scored.map(s => s.tx), prepayVendor, latestIssueDate })
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

  const { data: invoices, error: invErr } = await admin
    .from('tax_invoices')
    .select('id, total_amount')
    .in('id', invoiceIds)

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!invoices || invoices.length !== invoiceIds.length) {
    return NextResponse.json({ error: '일부 계산서를 찾을 수 없습니다.' }, { status: 404 })
  }

  for (const inv of invoices) {
    const result = await addInvoicePayment(admin, inv.id as string, transactionId, inv.total_amount as number)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const { data, error } = await admin
    .from('tax_invoices')
    .select(TAX_INVOICE_SELECT)
    .in('id', invoiceIds)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
