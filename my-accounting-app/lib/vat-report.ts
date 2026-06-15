import type { SupabaseClient } from '@supabase/supabase-js'

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
  // 세금계산서 - 매출(과세)
  const { data: salesInvoices, error: sie } = await admin
    .from('tax_invoices')
    .select('tax_amount')
    .eq('direction', 'sales')
    .eq('tax_type', 'taxable')
    .gte('issue_date', from)
    .lte('issue_date', to)
    .limit(50000)
  if (sie) return { error: sie.message }

  // 세금계산서 - 매입(과세)
  const { data: purchaseInvoices, error: pie } = await admin
    .from('tax_invoices')
    .select('tax_amount')
    .eq('direction', 'purchase')
    .eq('tax_type', 'taxable')
    .gte('issue_date', from)
    .lte('issue_date', to)
    .limit(50000)
  if (pie) return { error: pie.message }

  // 현금영수증 - 발행(매출)
  const { data: salesReceipts, error: sre } = await admin
    .from('cash_receipts')
    .select('tax_amount')
    .eq('direction', 'sales')
    .gte('tx_date', from)
    .lte('tx_date', to)
    .limit(50000)
  if (sre) return { error: sre.message }

  // 현금영수증 - 수취(매입, 공제분만)
  const { data: purchaseReceipts, error: pre } = await admin
    .from('cash_receipts')
    .select('tax_amount')
    .eq('direction', 'purchase')
    .eq('deductible', true)
    .gte('tx_date', from)
    .lte('tx_date', to)
    .limit(50000)
  if (pre) return { error: pre.message }

  // 카드매출 (승인/취소 합산, 취소는 음수)
  const { data: cardSales, error: cse } = await admin
    .from('card_sales')
    .select('tax_amount')
    .gte('tx_date', from)
    .lte('tx_date', to)
    .limit(200000)
  if (cse) return { error: cse.message }

  const salesInvoiceTax   = sumTax(salesInvoices)
  const purchaseInvoiceTax = sumTax(purchaseInvoices)
  const salesReceiptTax   = sumTax(salesReceipts)
  const purchaseReceiptTax = sumTax(purchaseReceipts)
  const cardSalesTax      = sumTax(cardSales)

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
