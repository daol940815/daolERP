import type { SupabaseClient } from '@supabase/supabase-js'
import type { VendorLedgerSummary, VendorMonthlyLedgerRow } from '@/types/vendor-ledger'

const PAGE_SIZE = 1000

async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: rows }
}

export interface VendorBalance {
  opening_balance: number
  invoice_total: number
  payment_total: number
  adjustment_total: number
  balance: number   // 현재잔액(미지급금) = 기초잔액 + 계산서 - 입금 + 조정
}

// 여러 거래처의 현재잔액(미지급금)을 한 번에 계산 — 매입처 목록 페이지용
// vendorIds를 생략하면 vendor_id가 있는 모든 거래처를 대상으로 한다.
export async function computeVendorBalances(
  admin: SupabaseClient,
  vendorIds?: string[],
): Promise<Map<string, VendorBalance> | { error: string }> {
  if (vendorIds && vendorIds.length === 0) return new Map()

  const invoiceResult = await fetchAllRows<{ vendor_id: string | null; total_amount: number | null }>((rFrom, rTo) => {
    let q = admin
      .from('tax_invoices')
      .select('vendor_id, total_amount')
      .eq('direction', 'purchase')
      .not('vendor_id', 'is', null)
    if (vendorIds) q = q.in('vendor_id', vendorIds)
    return q.range(rFrom, rTo)
  })
  if ('error' in invoiceResult) return { error: invoiceResult.error }

  const entriesResult = await fetchAllRows<{ vendor_id: string; entry_type: string; entry_date: string; amount: number; created_at: string }>((rFrom, rTo) => {
    let q = admin
      .from('vendor_ledger_entries')
      .select('vendor_id, entry_type, entry_date, amount, created_at')
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true })
    if (vendorIds) q = q.in('vendor_id', vendorIds)
    return q.range(rFrom, rTo)
  })
  if ('error' in entriesResult) return { error: entriesResult.error }

  const invoiceTotals = new Map<string, number>()
  for (const r of invoiceResult.data) {
    const vid = r.vendor_id as string
    invoiceTotals.set(vid, (invoiceTotals.get(vid) ?? 0) + (r.total_amount ?? 0))
  }

  // entry_date, created_at 오름차순으로 순회하므로 opening은 마지막에 덮어쓴 값이 최신(=유효) 기초잔액
  const openingByVendor = new Map<string, number>()
  const paymentTotals = new Map<string, number>()
  const adjustmentTotals = new Map<string, number>()
  for (const e of entriesResult.data) {
    if (e.entry_type === 'opening') openingByVendor.set(e.vendor_id, e.amount)
    else if (e.entry_type === 'payment') paymentTotals.set(e.vendor_id, (paymentTotals.get(e.vendor_id) ?? 0) + e.amount)
    else if (e.entry_type === 'adjustment') adjustmentTotals.set(e.vendor_id, (adjustmentTotals.get(e.vendor_id) ?? 0) + e.amount)
  }

  const ids = vendorIds ?? Array.from(new Set([
    ...Array.from(invoiceTotals.keys()), ...Array.from(openingByVendor.keys()),
    ...Array.from(paymentTotals.keys()), ...Array.from(adjustmentTotals.keys()),
  ]))

  const result = new Map<string, VendorBalance>()
  for (const vid of ids) {
    const opening    = openingByVendor.get(vid) ?? 0
    const invoice    = invoiceTotals.get(vid) ?? 0
    const payment    = paymentTotals.get(vid) ?? 0
    const adjustment = adjustmentTotals.get(vid) ?? 0
    result.set(vid, {
      opening_balance: opening,
      invoice_total: invoice,
      payment_total: payment,
      adjustment_total: adjustment,
      balance: opening + invoice - payment + adjustment,
    })
  }
  return result
}

// 거래처(vendor_id)가 매칭/변경/해제될 때 입출금내역의 출금을 정산 원장의 입금(payment)
// 항목과 동기화한다. vendor_id가 실제로 바뀐 경우에만 동작하는 전이(transition) 기반이라,
// 사용자가 등록된 항목을 취소(삭제)한 뒤 동일 거래에 대해 match-vendors 등이 재실행되어도
// (vendor_id가 그대로이므로) 다시 생성되지 않는다.
export async function syncTransactionPaymentEntry(
  admin: SupabaseClient,
  params: {
    transactionId: string
    prevVendorId: string | null
    newVendorId: string | null
    amountOut: number
    txDate: string
    description: string | null
  },
): Promise<{ ok: true } | { error: string }> {
  const { transactionId, prevVendorId, newVendorId, amountOut, txDate, description } = params
  if (prevVendorId === newVendorId) return { ok: true }

  const { error: delErr } = await admin
    .from('vendor_ledger_entries')
    .delete()
    .eq('transaction_id', transactionId)
  if (delErr) return { error: delErr.message }

  if (newVendorId && amountOut > 0) {
    const { error: insErr } = await admin
      .from('vendor_ledger_entries')
      .insert({
        vendor_id:      newVendorId,
        entry_type:     'payment',
        entry_date:     txDate.slice(0, 10),
        amount:         amountOut,
        memo:           description,
        transaction_id: transactionId,
      })
    if (insErr) return { error: insErr.message }
  }

  return { ok: true }
}

// 매입처 상세 페이지 — 정산 요약 + 월별 정산현황(매입금액/계산서/입금/조정/잔액)
export async function buildVendorMonthlyLedger(
  admin: SupabaseClient,
  vendorId: string,
): Promise<{ summary: VendorLedgerSummary; months: VendorMonthlyLedgerRow[] } | { error: string }> {
  const { data: aliases, error: aliasErr } = await admin
    .from('erp_vendor_aliases')
    .select('id')
    .eq('vendor_id', vendorId)
    .eq('alias_type', 'purchase')
  if (aliasErr) return { error: aliasErr.message }
  const aliasIds = (aliases ?? []).map(a => a.id as string)

  const purchaseByMonth = new Map<string, number>()
  if (aliasIds.length) {
    const itemsResult = await fetchAllRows<{ settlement_month: string | null; purchase_total: number | null }>((rFrom, rTo) =>
      admin
        .from('erp_order_items')
        .select('settlement_month, purchase_total')
        .in('purchase_alias_id', aliasIds)
        .eq('is_canceled', false)
        .eq('is_vip', false)
        .eq('is_prepayment', false)
        .range(rFrom, rTo),
    )
    if ('error' in itemsResult) return { error: itemsResult.error }
    for (const it of itemsResult.data) {
      if (!it.settlement_month) continue
      purchaseByMonth.set(it.settlement_month, (purchaseByMonth.get(it.settlement_month) ?? 0) + (it.purchase_total ?? 0))
    }
  }

  const invoiceResult = await fetchAllRows<{ issue_date: string; issued_date: string | null; total_amount: number | null }>((rFrom, rTo) =>
    admin
      .from('tax_invoices')
      .select('issue_date, issued_date, total_amount')
      .eq('direction', 'purchase')
      .eq('vendor_id', vendorId)
      .range(rFrom, rTo),
  )
  if ('error' in invoiceResult) return { error: invoiceResult.error }

  const invoiceByMonth = new Map<string, number>()
  const carriedOverMonths = new Set<string>()
  for (const inv of invoiceResult.data) {
    const month = inv.issue_date.slice(0, 7)
    invoiceByMonth.set(month, (invoiceByMonth.get(month) ?? 0) + (inv.total_amount ?? 0))
    if (inv.issued_date && inv.issued_date.slice(0, 7) !== month) carriedOverMonths.add(month)
  }

  const entriesResult = await fetchAllRows<{ entry_type: string; entry_date: string; amount: number; created_at: string }>((rFrom, rTo) =>
    admin
      .from('vendor_ledger_entries')
      .select('entry_type, entry_date, amount, created_at')
      .eq('vendor_id', vendorId)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true })
      .range(rFrom, rTo),
  )
  if ('error' in entriesResult) return { error: entriesResult.error }

  let openingBalance = 0
  const paymentByMonth = new Map<string, number>()
  const adjustmentByMonth = new Map<string, number>()
  for (const e of entriesResult.data) {
    const month = e.entry_date.slice(0, 7)
    if (e.entry_type === 'opening') openingBalance = e.amount
    else if (e.entry_type === 'payment') paymentByMonth.set(month, (paymentByMonth.get(month) ?? 0) + e.amount)
    else if (e.entry_type === 'adjustment') adjustmentByMonth.set(month, (adjustmentByMonth.get(month) ?? 0) + e.amount)
  }

  const allMonths = new Set<string>([
    ...Array.from(purchaseByMonth.keys()), ...Array.from(invoiceByMonth.keys()),
    ...Array.from(paymentByMonth.keys()), ...Array.from(adjustmentByMonth.keys()),
  ])
  const sortedMonths = Array.from(allMonths).sort()

  let running = openingBalance
  const months: VendorMonthlyLedgerRow[] = sortedMonths.map(month => {
    const invoice = invoiceByMonth.get(month) ?? 0
    const payment = paymentByMonth.get(month) ?? 0
    const adjustment = adjustmentByMonth.get(month) ?? 0
    running = running + invoice - payment + adjustment
    return {
      month,
      purchase_amount: purchaseByMonth.get(month) ?? 0,
      invoice_amount: invoice,
      invoice_carried_over: carriedOverMonths.has(month),
      payment_amount: payment,
      adjustment_amount: adjustment,
      balance: running,
    }
  })

  const currentMonth = new Date().toISOString().slice(0, 7)
  const summary: VendorLedgerSummary = {
    opening_balance: openingBalance,
    month_invoice: invoiceByMonth.get(currentMonth) ?? 0,
    month_payment: paymentByMonth.get(currentMonth) ?? 0,
    current_balance: running,
  }

  return { summary, months }
}
