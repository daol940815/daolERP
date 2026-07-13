import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ── 예상 부가세 ──────────────────────────────────────────
// 세금계산서/현금영수증/카드매출 자료를 바탕으로 기간 내 매출세액·매입세액을 집계해
// 예상 부가세(납부 또는 환급)를 추정한다. 실제 신고 시 가산/공제 항목과 차이가 있을 수 있다.

export interface VatBreakdownItem {
  label: string
  amount: number
}

export interface VatEstimateResult {
  from: string
  to: string
  sales_tax: number      // 매출세액 합계
  purchase_tax: number   // 매입세액 합계
  estimated_vat: number  // 매출세액 - 매입세액 (양수: 납부예상, 음수: 환급예상)
  sales_breakdown: VatBreakdownItem[]
  purchase_breakdown: VatBreakdownItem[]
}

function sumTax(rows: { tax_amount: number | null }[] | null): number {
  return (rows ?? []).reduce((s, r) => s + ((r.tax_amount as number) || 0), 0)
}

export async function buildVatEstimate(
  admin: SupabaseClient,
  from: string,
  to: string,
): Promise<{ result: VatEstimateResult } | { error: string }> {
  type TaxRow = { tax_amount: number | null }

  // 세금계산서 - 매출(과세)
  const salesInvoices = await fetchAllRows<TaxRow>((rFrom, rTo) =>
    admin
      .from('tax_invoices')
      .select('tax_amount')
      .eq('direction', 'sales')
      .eq('tax_type', 'taxable')
      .gte('issue_date', from)
      .lte('issue_date', to)
      .range(rFrom, rTo),
  )
  if ('error' in salesInvoices) return { error: salesInvoices.error }

  // 세금계산서 - 매입(과세)
  const purchaseInvoices = await fetchAllRows<TaxRow>((rFrom, rTo) =>
    admin
      .from('tax_invoices')
      .select('tax_amount')
      .eq('direction', 'purchase')
      .eq('tax_type', 'taxable')
      .gte('issue_date', from)
      .lte('issue_date', to)
      .range(rFrom, rTo),
  )
  if ('error' in purchaseInvoices) return { error: purchaseInvoices.error }

  // 현금영수증 - 발행(매출)
  const salesReceipts = await fetchAllRows<TaxRow>((rFrom, rTo) =>
    admin
      .from('cash_receipts')
      .select('tax_amount')
      .eq('direction', 'sales')
      .gte('tx_date', from)
      .lte('tx_date', to)
      .range(rFrom, rTo),
  )
  if ('error' in salesReceipts) return { error: salesReceipts.error }

  // 현금영수증 - 수취(매입, 공제분만)
  const purchaseReceipts = await fetchAllRows<TaxRow>((rFrom, rTo) =>
    admin
      .from('cash_receipts')
      .select('tax_amount')
      .eq('direction', 'purchase')
      .eq('deductible', true)
      .gte('tx_date', from)
      .lte('tx_date', to)
      .range(rFrom, rTo),
  )
  if ('error' in purchaseReceipts) return { error: purchaseReceipts.error }

  // 카드매출 (승인/취소 합산, 취소는 음수)
  const cardSales = await fetchAllRows<TaxRow>((rFrom, rTo) =>
    admin
      .from('card_sales')
      .select('tax_amount')
      .gte('tx_date', from)
      .lte('tx_date', to)
      .range(rFrom, rTo),
  )
  if ('error' in cardSales) return { error: cardSales.error }

  const salesInvoiceTax   = sumTax(salesInvoices.data)
  const purchaseInvoiceTax = sumTax(purchaseInvoices.data)
  const salesReceiptTax   = sumTax(salesReceipts.data)
  const purchaseReceiptTax = sumTax(purchaseReceipts.data)
  const cardSalesTax      = sumTax(cardSales.data)

  const sales_tax    = salesInvoiceTax + salesReceiptTax + cardSalesTax
  const purchase_tax = purchaseInvoiceTax + purchaseReceiptTax

  return {
    result: {
      from,
      to,
      sales_tax,
      purchase_tax,
      estimated_vat: sales_tax - purchase_tax,
      sales_breakdown: [
        { label: '세금계산서(매출)', amount: salesInvoiceTax },
        { label: '현금영수증(발행)', amount: salesReceiptTax },
        { label: '카드매출', amount: cardSalesTax },
      ],
      purchase_breakdown: [
        { label: '세금계산서(매입)', amount: purchaseInvoiceTax },
        { label: '현금영수증(매입·공제)', amount: purchaseReceiptTax },
      ],
    },
  }
}
