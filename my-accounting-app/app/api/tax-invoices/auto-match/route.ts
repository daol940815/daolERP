import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { addInvoicePayment } from '@/lib/tax-invoice-payments.server'

export const dynamic = 'force-dynamic'

// POST /api/tax-invoices/auto-match — body: { direction?, taxType? }
// 미확인(unmatched) 세금계산서 중, 금액이 일치하고 사업자번호 또는 거래처명이
// 적요에 포함되는 거래내역이 단 하나로 좁혀지는 건만 자동으로 연결 처리한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { direction?: string; taxType?: string }

  let query = admin
    .from('tax_invoices')
    .select('id, direction, total_amount, issue_date, vendor_id, counterparty_name, counterparty_biz_number')
    .eq('payment_status', 'unmatched')

  if (body.direction) query = query.eq('direction', body.direction)
  if (body.taxType)   query = query.eq('tax_type', body.taxType)

  const { data: invoices, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 이미 부분/분할 결제가 연결된 계산서는 자동매칭이 건너뛰고 수동(직접 찾기)으로 처리
  const invoiceIds = (invoices ?? []).map(inv => inv.id as string)
  const partiallyPaidIds = new Set<string>()
  if (invoiceIds.length) {
    const { data: existingPayments } = await admin
      .from('tax_invoice_payments')
      .select('tax_invoice_id')
      .in('tax_invoice_id', invoiceIds)
    for (const p of existingPayments ?? []) partiallyPaidIds.add(p.tax_invoice_id as string)
  }

  // 매칭된 거래처들의 학습된 별칭(입금자명 등)을 한 번에 조회해 N+1 쿼리 방지
  const vendorIds = Array.from(new Set((invoices ?? []).map(inv => inv.vendor_id).filter((v): v is string => !!v)))
  const aliasMap = new Map<string, string[]>()
  if (vendorIds.length) {
    const { data: vendors } = await admin
      .from('vendors')
      .select('id, match_aliases')
      .in('id', vendorIds)
    for (const v of vendors ?? []) {
      aliasMap.set(v.id as string, (v.match_aliases as string[] | null) ?? [])
    }
  }

  let matched = 0
  for (const inv of invoices ?? []) {
    if (partiallyPaidIds.has(inv.id as string)) continue

    const amountCol = inv.direction === 'sales' ? 'amount_in' : 'amount_out'
    const { data: txs } = await admin
      .from('transactions')
      .select('id, description, counterparty_name, vendor_id')
      .eq(amountCol, inv.total_amount)
      .is('transfer_pair_id', null)

    const bizDigits = inv.counterparty_biz_number?.replace(/[^0-9]/g, '') ?? ''
    const name      = inv.counterparty_name?.trim() ?? ''
    const aliases   = inv.vendor_id ? (aliasMap.get(inv.vendor_id) ?? []) : []

    const candidates = (txs ?? []).filter(tx => {
      const desc           = (tx.description as string) ?? ''
      const counterparty   = (tx.counterparty_name as string | null) ?? ''
      const haystack       = `${desc} ${counterparty}`
      const haystackDigits = haystack.replace(/[^0-9]/g, '')
      return (inv.vendor_id && tx.vendor_id === inv.vendor_id)
        || (bizDigits && haystackDigits.includes(bizDigits))
        || (name && haystack.includes(name))
        || aliases.some(alias => alias && haystack.includes(alias))
    })

    if (candidates.length === 1) {
      const result = await addInvoicePayment(admin, inv.id as string, candidates[0].id as string, inv.total_amount as number)
      if (result.ok) matched++
    }
  }

  return NextResponse.json({ matched, checked: invoices?.length ?? 0 })
}
