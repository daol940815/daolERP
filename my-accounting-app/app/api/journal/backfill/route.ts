import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { syncTransactionJournal } from '@/lib/journal/bank-posting'
import { syncCardExpenseJournal } from '@/lib/journal/card-posting'
import { syncTaxInvoiceJournal } from '@/lib/journal/tax-invoice-posting'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/journal/backfill
// 이미 확정된 원천(은행거래·법인카드·세금계산서)을 일괄 전기한다(멱등 — 여러 번 실행해도 안전).
export async function POST() {
  const admin = createAdminClient()

  // 1) 확정된 은행거래
  const bankResult = await fetchAllRows<{ id: string }>((f, t) =>
    admin
      .from('transactions')
      .select('id')
      .eq('status', 'confirmed')
      .not('confirmed_account_id', 'is', null)
      .is('transfer_pair_id', null)
      .range(f, t),
  )
  if ('error' in bankResult) return NextResponse.json({ error: bankResult.error }, { status: 500 })

  let bankPosted = 0
  const errors: { source: string; id: string; error: string }[] = []
  for (const tx of bankResult.data) {
    const jr = await syncTransactionJournal(admin, tx.id)
    if ('error' in jr) errors.push({ source: 'bank', id: tx.id, error: jr.error })
    else bankPosted++
  }

  // 2) 확정된 법인카드 사용내역
  const cardResult = await fetchAllRows<{ id: string }>((f, t) =>
    admin
      .from('card_expenses')
      .select('id')
      .eq('classify_status', 'confirmed')
      .not('confirmed_account_id', 'is', null)
      .gt('approved_amount', 0)
      .range(f, t),
  )
  if ('error' in cardResult) return NextResponse.json({ error: cardResult.error }, { status: 500 })

  let cardPosted = 0
  for (const exp of cardResult.data) {
    const jr = await syncCardExpenseJournal(admin, exp.id)
    if ('error' in jr) errors.push({ source: 'card', id: exp.id, error: jr.error })
    else cardPosted++
  }

  // 3) 계정 확정된 세금계산서
  const taxResult = await fetchAllRows<{ id: string }>((f, t) =>
    admin
      .from('tax_invoices')
      .select('id')
      .not('confirmed_account_id', 'is', null)
      .neq('total_amount', 0)
      .range(f, t),
  )
  if ('error' in taxResult) return NextResponse.json({ error: taxResult.error }, { status: 500 })

  let taxPosted = 0
  for (const inv of taxResult.data) {
    const jr = await syncTaxInvoiceJournal(admin, inv.id)
    if ('error' in jr) errors.push({ source: 'tax_invoice', id: inv.id, error: jr.error })
    else taxPosted++
  }

  return NextResponse.json({
    bank: { candidates: bankResult.data.length, posted: bankPosted },
    card: { candidates: cardResult.data.length, posted: cardPosted },
    tax_invoice: { candidates: taxResult.data.length, posted: taxPosted },
    errors,
  })
}
