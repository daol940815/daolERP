import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// GET /api/tax-invoices/:id/match-candidates
// 금액이 일치하는 거래내역 중, 사업자번호·거래처명이 적요에 포함되거나
// 동일 거래처로 태깅된 건을 우선순위로 정렬해 매칭 후보로 제시
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const { data: invoice, error: invErr } = await admin
    .from('tax_invoices')
    .select('id, direction, total_amount, issue_date, vendor_id, counterparty_name, counterparty_biz_number')
    .eq('id', id)
    .single()

  if (invErr || !invoice) {
    return NextResponse.json({ error: invErr?.message ?? '세금계산서를 찾을 수 없습니다.' }, { status: 404 })
  }

  // 거래처가 매칭되어 있으면 학습된 별칭(입금자명 등)도 함께 검사
  let aliases: string[] = []
  if (invoice.vendor_id) {
    const { data: vendor } = await admin
      .from('vendors')
      .select('match_aliases')
      .eq('id', invoice.vendor_id)
      .single()
    aliases = (vendor?.match_aliases as string[] | null) ?? []
  }

  // 매출(받을 돈) → 입금액과 비교 / 매입(줄 돈) → 출금액과 비교
  const amountCol = invoice.direction === 'sales' ? 'amount_in' : 'amount_out'

  const { data: amountMatches, error } = await admin
    .from('transactions')
    .select('id, tx_date, description, amount_in, amount_out, account_alias, vendor_id, confirmed_account_id')
    .eq(amountCol, invoice.total_amount)
    .order('tx_date', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bizDigits = invoice.counterparty_biz_number?.replace(/[^0-9]/g, '') ?? ''
  const name      = invoice.counterparty_name?.trim() ?? ''
  const issueTime = new Date(invoice.issue_date as string).getTime()

  const scored = (amountMatches ?? []).map(tx => {
    const desc       = (tx.description as string) ?? ''
    const descDigits = desc.replace(/[^0-9]/g, '')
    const dayDiff    = Math.abs(new Date(tx.tx_date as string).getTime() - issueTime) / 86_400_000

    let score = 0
    if (invoice.vendor_id && tx.vendor_id === invoice.vendor_id)     score += 3
    if (bizDigits && descDigits.includes(bizDigits))                 score += 2
    if (name && desc.includes(name))                                 score += 2
    if (aliases.some(alias => alias && desc.includes(alias)))        score += 2
    if (dayDiff <= 31)                                               score += 1

    return { tx, score, dayDiff }
  })

  scored.sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff)

  return NextResponse.json({ candidates: scored.map(s => s.tx) })
}
