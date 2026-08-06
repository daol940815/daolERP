import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ── 예상 부가세 ──────────────────────────────────────────
// 세금계산서/현금영수증/카드매출/법인카드 자료를 바탕으로 기간 내 매출세액·매입세액을
// 집계해 예상 부가세(납부 또는 환급)를 추정한다. 실제 신고 시 가산/공제 항목과 차이가 있을 수 있다.
//
// 법인카드 매입세액은 공제분만 반영한다 (신용카드매출전표 수취분 매입세액공제):
//   · 접대비 확정 건 — 세법상 명시적 불공제
//   · 차량유지비 확정 건 — 보유 차량(K8·G80·G90·XM3) 전부 개별소비세 과세 승용차라
//     비영업용 소형승용차 유지비로 불공제 (2026-07 사용자 확인)
//   · 세액 0 표기(면세·간이 가맹점 등)와 승인거절 건은 자동 제외, 취소(음수)는 상쇄
//   · 미확정 건은 공제 판단 불가 — 보수적으로 제외
const CARD_NON_DEDUCTIBLE_ACCOUNTS = ['접대비', '차량유지비']

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

// ── 신고기간·월별 보기 (신고서 서식 구조) ─────────────────
// 자동 집계 행은 월별로, 수동 입력 항목(vat_manual_entries)은 신고기간 단위로 반환.
// 파생 합계(계·차감계·납부세액·차가감)는 화면에서 계산한다.
export interface VatCell { supply: number; tax: number }
export interface VatReturnView {
  year: number
  m1: number
  m2: number
  months: number[]
  period_key: string
  // 각 배열은 months 순서 + 마지막에 기간 합계 1개
  auto: {
    sales_invoice: VatCell[]
    sales_card_cash: VatCell[]
    purchase_invoice: VatCell[]
    purchase_card_cash: VatCell[]
    purchase_nondeduct: VatCell[]
  }
  manual: Record<string, VatCell>
  card_missing: { count: number; amount: number }
  migration106: boolean
}

export async function buildVatReturnView(
  admin: SupabaseClient,
  year: number,
  m1: number,
  m2: number,
): Promise<{ result: VatReturnView } | { error: string }> {
  const pad = (n: number) => String(n).padStart(2, '0')
  const from = `${year}-${pad(m1)}-01`
  const to = `${year}-${pad(m2)}-${new Date(year, m2, 0).getDate()}`
  const months: number[] = []
  for (let m = m1; m <= m2; m++) months.push(m)
  const idxOf = (date: string) => {
    const m = parseInt(date.slice(5, 7), 10)
    return m - m1
  }
  const zero = (): VatCell[] => months.map(() => ({ supply: 0, tax: 0 })).concat([{ supply: 0, tax: 0 }])
  const add = (cells: VatCell[], date: string, supply: number, tax: number) => {
    const i = idxOf(date)
    if (i < 0 || i >= months.length) return
    cells[i].supply += supply; cells[i].tax += tax
    cells[months.length].supply += supply; cells[months.length].tax += tax
  }

  const [invR, receiptR, cardSalesR, cardExpR, nonDeductAcc] = await Promise.all([
    fetchAllRows<{ issue_date: string; direction: string; tax_type: string; supply_amount: number | null; tax_amount: number | null }>(
      (f, t) => admin.from('tax_invoices')
        .select('issue_date, direction, tax_type, supply_amount, tax_amount')
        .eq('tax_type', 'taxable').gte('issue_date', from).lte('issue_date', to).range(f, t)),
    fetchAllRows<{ tx_date: string; direction: string; deductible: boolean | null; supply_amount: number | null; tax_amount: number | null }>(
      (f, t) => admin.from('cash_receipts')
        .select('tx_date, direction, deductible, supply_amount, tax_amount')
        .gte('tx_date', from).lte('tx_date', to).range(f, t)),
    fetchAllRows<{ tx_date: string; amount: number | null; supply_amount: number | null; tax_amount: number | null }>(
      (f, t) => admin.from('card_sales')
        .select('tx_date, amount, supply_amount, tax_amount')
        .gte('tx_date', from).lte('tx_date', to).range(f, t)),
    fetchAllRows<{ tx_date: string; tax_amount: number | null; settled_amount: number | null; approved_amount: number | null; cancel_amount: number | null; confirmed_account_id: string | null; statement_status: string | null; classify_status: string }>(
      (f, t) => admin.from('card_expenses')
        .select('tx_date, tax_amount, settled_amount, approved_amount, cancel_amount, confirmed_account_id, statement_status, classify_status')
        .gte('tx_date', from).lte('tx_date', to).range(f, t)),
    admin.from('accounts').select('id').in('name', CARD_NON_DEDUCTIBLE_ACCOUNTS),
  ])
  for (const r of [invR, receiptR, cardSalesR, cardExpR]) {
    if ('error' in r) return { error: r.error }
  }
  const nonDeductibleIds = new Set((nonDeductAcc.data ?? []).map(a => a.id as string))

  const auto = {
    sales_invoice: zero(),
    sales_card_cash: zero(),
    purchase_invoice: zero(),
    purchase_card_cash: zero(),
    purchase_nondeduct: zero(),
  }

  for (const r of (invR as { data: { issue_date: string; direction: string; supply_amount: number | null; tax_amount: number | null }[] }).data) {
    const target = r.direction === 'sales' ? auto.sales_invoice : auto.purchase_invoice
    add(target, r.issue_date, r.supply_amount || 0, r.tax_amount || 0)
  }
  for (const r of (receiptR as { data: { tx_date: string; direction: string; deductible: boolean | null; supply_amount: number | null; tax_amount: number | null }[] }).data) {
    if (r.direction === 'sales') {
      add(auto.sales_card_cash, r.tx_date, r.supply_amount || 0, r.tax_amount || 0)
    } else {
      add(auto.purchase_card_cash, r.tx_date, r.supply_amount || 0, r.tax_amount || 0)
      // 공제 여부 미기재(NULL)는 판단 불가 — 보수적으로 불공제 처리 (기존 요약 로직과 동일)
      if (r.deductible !== true) add(auto.purchase_nondeduct, r.tx_date, r.supply_amount || 0, r.tax_amount || 0)
    }
  }
  const card_missing = { count: 0, amount: 0 }
  for (const r of (cardSalesR as { data: { tx_date: string; amount: number | null; supply_amount: number | null; tax_amount: number | null }[] }).data) {
    const amt = r.amount || 0, sup = r.supply_amount || 0, tax = r.tax_amount || 0
    if (sup === 0 && tax === 0 && amt !== 0) { card_missing.count += 1; card_missing.amount += amt }
    add(auto.sales_card_cash, r.tx_date, sup, tax)
  }
  for (const r of (cardExpR as { data: { tx_date: string; tax_amount: number | null; settled_amount: number | null; approved_amount: number | null; cancel_amount: number | null; confirmed_account_id: string | null; statement_status: string | null; classify_status: string }[] }).data) {
    if ((r.statement_status ?? '').includes('거절')) continue
    if (r.classify_status !== 'confirmed' || !r.confirmed_account_id) continue
    const tax = r.tax_amount || 0
    if (!tax) continue
    const used = r.settled_amount ?? ((r.approved_amount || 0) - (r.cancel_amount || 0))
    const supply = used - tax
    add(auto.purchase_card_cash, r.tx_date, supply, tax)
    if (nonDeductibleIds.has(r.confirmed_account_id)) add(auto.purchase_nondeduct, r.tx_date, supply, tax)
  }

  // 수동 입력 항목 (106 미적용 시 빈 값 폴백)
  const period_key = `${year}-${m1}-${m2}`
  const manual: Record<string, VatCell> = {}
  let migration106 = true
  {
    const { data, error } = await admin.from('vat_manual_entries')
      .select('item_key, supply_amount, tax_amount').eq('period_key', period_key)
    if (error) {
      if (/vat_manual_entries/.test(error.message)) migration106 = false
      else return { error: error.message }
    } else {
      for (const r of data ?? []) manual[r.item_key as string] = {
        supply: Number(r.supply_amount) || 0, tax: Number(r.tax_amount) || 0 }
    }
  }

  return { result: { year, m1, m2, months, period_key, auto, manual, card_missing, migration106 } }
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
  // 원본이 건별 공급가액/세액을 구분 제공 — 면세 건은 세액 0이라 자동 제외된다.
  // 공급가·세액이 모두 0인데 승인금액이 있는 건은 구분 미기재(원자료 누락)로 별도 표시.
  const cardSales = await fetchAllRows<{ amount: number | null; supply_amount: number | null; tax_amount: number | null }>((rFrom, rTo) =>
    admin
      .from('card_sales')
      .select('amount, supply_amount, tax_amount')
      .gte('tx_date', from)
      .lte('tx_date', to)
      .range(rFrom, rTo),
  )
  if ('error' in cardSales) return { error: cardSales.error }
  let cardTaxableSupply = 0, cardFreeAmount = 0, cardMissingCount = 0, cardMissingAmount = 0
  for (const r of cardSales.data) {
    const amt = r.amount || 0, sup = r.supply_amount || 0, tax = r.tax_amount || 0
    if (tax !== 0) cardTaxableSupply += sup
    else if (sup === 0 && amt !== 0) { cardMissingCount += 1; cardMissingAmount += amt }
    else cardFreeAmount += sup
  }

  // 법인카드 사용분 매입세액 (공제분만 — 파일 상단 규칙 참조)
  const cardExpensesResult = await fetchAllRows<{ tax_amount: number | null; confirmed_account_id: string | null; statement_status: string | null; classify_status: string }>((rFrom, rTo) =>
    admin
      .from('card_expenses')
      .select('tax_amount, confirmed_account_id, statement_status, classify_status')
      .gte('tx_date', from)
      .lte('tx_date', to)
      .range(rFrom, rTo),
  )
  if ('error' in cardExpensesResult) return { error: cardExpensesResult.error }

  const { data: nonDeductAccounts } = await admin
    .from('accounts')
    .select('id')
    .in('name', CARD_NON_DEDUCTIBLE_ACCOUNTS)
  const nonDeductibleIds = new Set((nonDeductAccounts ?? []).map(a => a.id as string))

  const cardExpenseTax = cardExpensesResult.data.reduce((s, r) => {
    if ((r.statement_status ?? '').includes('거절')) return s
    if (r.classify_status !== 'confirmed' || !r.confirmed_account_id) return s
    if (nonDeductibleIds.has(r.confirmed_account_id)) return s
    return s + ((r.tax_amount as number) || 0)
  }, 0)

  const salesInvoiceTax   = sumTax(salesInvoices.data)
  const purchaseInvoiceTax = sumTax(purchaseInvoices.data)
  const salesReceiptTax   = sumTax(salesReceipts.data)
  const purchaseReceiptTax = sumTax(purchaseReceipts.data)
  const cardSalesTax      = sumTax(cardSales.data)

  const sales_tax    = salesInvoiceTax + salesReceiptTax + cardSalesTax
  const purchase_tax = purchaseInvoiceTax + purchaseReceiptTax + cardExpenseTax

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
        {
          label: `카드매출 (과세 공급가 ${cardTaxableSupply.toLocaleString('ko-KR')}원 · 면세 ${cardFreeAmount.toLocaleString('ko-KR')}원 세액 제외${
            cardMissingCount ? ` · 구분 미기재 ${cardMissingCount}건 ${cardMissingAmount.toLocaleString('ko-KR')}원 — 확인 필요` : ''}`,
          amount: cardSalesTax,
        },
      ],
      purchase_breakdown: [
        { label: '세금계산서(매입)', amount: purchaseInvoiceTax },
        { label: '현금영수증(매입·공제)', amount: purchaseReceiptTax },
        { label: '법인카드(공제분 — 접대비·차량유지비 제외)', amount: cardExpenseTax },
      ],
    },
  }
}
