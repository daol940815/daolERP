import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ── 월별 손익 "증빙 기준" 매출·매출원가 집계 (2026-11-03 사용자 결정: 기본 보기) ─────────────
// 매출  = 매출 세금계산서(과세, 공급가액) + 매출 계산서(면세) + 카드매출(승인−취소, 공급가액) + 현금영수증 매출(승인−취소, 공급가액)
//         − 중복(현금영수증과 같은 사업자번호·금액·±7일의 매출 계산서가 있으면 현금영수증을 뺀다)
//         * 임대료수익 등 매출(4001)이 아닌 수익 계정으로 확정된 계산서는 여기서 빼고 분개 쪽(계정별 행)으로 보낸다
//         * 카드매출은 상대 식별 정보가 없어 중복 제거 대상이 아니다(계산서+카드 병행은 드물다고 본다)
// 매출원가 = 상품매입(5002)·매출원가(5001) 분개를 원천(세금계산서/법인카드)별로 나눠 보여준다 — 재고 실사가 없어 당월 매입 = 당월 원가
// 인식 시점: 계산서 작성일 · 카드 승인일 · 현금영수증 거래일 · 카드 이용일
// 부가세 신고 합계표와 같은 숫자가 나와야 정상 — 다르면 업로드 누락.

export interface EvidenceRevenue {
  invTaxable: number[]   // 매출 세금계산서(과세) 공급가액
  invExempt: number[]    // 매출 계산서(면세)
  cardSales: number[]    // 카드매출 순액(공급가액)
  cashReceipts: number[] // 현금영수증 매출 순액(공급가액)
  dedupe: number[]       // 중복 제거(음수)
  dedupeCount: number
  cogsInvoice: number[]  // 상품매입 — 세금계산서 분개
  cogsCard: number[]     // 상품매입 — 법인카드 분개
  cogsOther: number[]    // 상품매입 — 그 밖(통장·수동)
  unclassifiedPurchase: number[]   // 미분류 매입 계산서 합계(분개 없음 → 원가·비용 어디에도 안 잡힘) — 0이 아니면 분류 작업 필요
  unclassifiedPurchaseCount: number
  unclassifiedCard: number[]       // 미확정 법인카드 승인−취소 합계
  unclassifiedCardCount: number
}

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')
const supplyOf = (supply: number | null, amount: number | null, tax: number | null) => {
  if (supply && supply !== 0) return supply
  const a = amount ?? 0
  if (tax && tax !== 0) return a - tax
  return Math.round(a / 1.1)   // 공급가액 정보가 없으면 부가세 10% 역산
}

export async function buildEvidenceRevenue(
  admin: SupabaseClient,
  months: string[],
  dateFrom: string,
  dateTo: string,
  accounts: Map<string, { code: string; name: string; type: string }>,
  cogsAccountIds: string[],
): Promise<{ data: EvidenceRevenue } | { error: string }> {
  const idx = new Map(months.map((m, i) => [m, i]))
  const zero = () => months.map(() => 0)
  const out: EvidenceRevenue = {
    invTaxable: zero(), invExempt: zero(), cardSales: zero(), cashReceipts: zero(), dedupe: zero(), dedupeCount: 0,
    cogsInvoice: zero(), cogsCard: zero(), cogsOther: zero(),
    unclassifiedPurchase: zero(), unclassifiedPurchaseCount: 0, unclassifiedCard: zero(), unclassifiedCardCount: 0,
  }
  const monthOf = (d: string) => idx.get(d.slice(0, 7))

  // 0) 미분류 원본 — 분개가 없어 손익 어디에도 안 잡히는 금액을 따로 보여준다 (0원이 "없다"가 아니라 "아직 분류 전"일 수 있다)
  {
    const up = await fetchAllRows<{ issue_date: string; total_amount: number | null }>((f, t) =>
      admin.from('tax_invoices').select('issue_date, total_amount')
        .eq('direction', 'purchase').is('confirmed_account_id', null)
        .gte('issue_date', dateFrom).lte('issue_date', dateTo).range(f, t))
    if ('error' in up) return { error: up.error }
    for (const r of up.data) { const i = monthOf(r.issue_date); if (i !== undefined) { out.unclassifiedPurchase[i] += r.total_amount ?? 0; out.unclassifiedPurchaseCount++ } }
    const uc = await fetchAllRows<{ tx_date: string; approved_amount: number | null; cancel_amount: number | null }>((f, t) =>
      admin.from('card_expenses').select('tx_date, approved_amount, cancel_amount')
        .neq('classify_status', 'confirmed')
        .gte('tx_date', dateFrom).lte('tx_date', dateTo).range(f, t))
    if ('error' in uc) return { error: uc.error }
    for (const r of uc.data) { const i = monthOf(r.tx_date); if (i !== undefined) { out.unclassifiedCard[i] += (r.approved_amount ?? 0) - (r.cancel_amount ?? 0); out.unclassifiedCardCount++ } }
  }

  // 1) 매출 계산서 — 매출(4001)·미분류만 매출 행에, 다른 수익 계정으로 확정된 것은 분개 쪽으로
  type Inv = { issue_date: string; tax_type: string; supply_amount: number | null; total_amount: number | null; tax_amount: number | null; confirmed_account_id: string | null; counterparty_biz_number: string | null }
  const invRes = await fetchAllRows<Inv>((f, t) =>
    admin.from('tax_invoices')
      .select('issue_date, tax_type, supply_amount, total_amount, tax_amount, confirmed_account_id, counterparty_biz_number')
      .eq('direction', 'sales').gte('issue_date', dateFrom).lte('issue_date', dateTo).range(f, t))
  if ('error' in invRes) return { error: invRes.error }
  const invByBiz = new Map<string, { date: string; total: number }[]>()   // 현금영수증 중복 제거용
  for (const inv of invRes.data) {
    const acc = inv.confirmed_account_id ? accounts.get(inv.confirmed_account_id) : null
    const i = monthOf(inv.issue_date)
    if (i === undefined) continue
    const b = digits(inv.counterparty_biz_number)
    if (b) {
      const arr = invByBiz.get(b) ?? []
      arr.push({ date: inv.issue_date.slice(0, 10), total: inv.total_amount ?? 0 })
      invByBiz.set(b, arr)
    }
    if (acc && acc.type === 'income' && acc.code !== '4001') continue   // 임대료수익·잡이익 등 → 계정별 행
    const supply = inv.tax_type === 'exempt'
      ? (inv.supply_amount || inv.total_amount || 0)
      : supplyOf(inv.supply_amount, inv.total_amount, inv.tax_amount)
    if (inv.tax_type === 'exempt') out.invExempt[i] += supply
    else out.invTaxable[i] += supply
  }

  // 2) 카드매출 — 승인 − 취소, 공급가액
  type CardSale = { tx_date: string; transaction_type: string; amount: number | null; supply_amount: number | null; tax_amount: number | null }
  const csRes = await fetchAllRows<CardSale>((f, t) =>
    admin.from('card_sales').select('tx_date, transaction_type, amount, supply_amount, tax_amount')
      .gte('tx_date', dateFrom).lte('tx_date', dateTo).range(f, t))
  if ('error' in csRes) return { error: csRes.error }
  for (const r of csRes.data) {
    const i = monthOf(r.tx_date)
    if (i === undefined) continue
    const s = Math.abs(supplyOf(r.supply_amount, r.amount, r.tax_amount))
    out.cardSales[i] += r.transaction_type === 'cancel' ? -s : s
  }

  // 3) 현금영수증 매출 — 승인 − 취소, 공급가액. 같은 사업자번호·금액·±7일의 매출 계산서가 있으면 중복으로 뺀다
  type CashRcpt = { tx_date: string; transaction_type: string; amount: number | null; supply_amount: number | null; tax_amount: number | null; counterparty_biz_number: string | null }
  const crRes = await fetchAllRows<CashRcpt>((f, t) =>
    admin.from('cash_receipts').select('tx_date, transaction_type, amount, supply_amount, tax_amount, counterparty_biz_number')
      .eq('direction', 'sales').gte('tx_date', dateFrom).lte('tx_date', dateTo).range(f, t))
  if ('error' in crRes) return { error: crRes.error }
  const dayDiff = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000
  for (const r of crRes.data) {
    const i = monthOf(r.tx_date)
    if (i === undefined) continue
    const s = Math.abs(supplyOf(r.supply_amount, r.amount, r.tax_amount))
    const signed = r.transaction_type === 'cancel' ? -s : s
    out.cashReceipts[i] += signed
    if (r.transaction_type !== 'cancel') {
      const b = digits(r.counterparty_biz_number)
      const cands = b ? invByBiz.get(b) ?? [] : []
      const k = cands.findIndex(c => c.total === (r.amount ?? 0) && dayDiff(c.date, r.tx_date.slice(0, 10)) <= 7)
      if (k >= 0) { cands.splice(k, 1); out.dedupe[i] -= s; out.dedupeCount++ }
    }
  }

  // 4) 매출원가 — 5001·5002 분개를 원천별로
  if (cogsAccountIds.length) {
    type JL = { amount: number; side: string; journal_entries: { entry_date: string; source_type: string } | { entry_date: string; source_type: string }[] | null }
    const jlRes = await fetchAllRows<JL>((f, t) =>
      admin.from('journal_lines')
        .select('amount, side, journal_entries!inner(entry_date, source_type)')
        .in('account_id', cogsAccountIds)
        .gte('journal_entries.entry_date', dateFrom).lte('journal_entries.entry_date', dateTo)
        .range(f, t))
    if ('error' in jlRes) return { error: jlRes.error }
    for (const l of jlRes.data) {
      const je = Array.isArray(l.journal_entries) ? l.journal_entries[0] : l.journal_entries
      if (!je) continue
      const i = monthOf(String(je.entry_date))
      if (i === undefined) continue
      const v = l.side === 'debit' ? (l.amount ?? 0) : -(l.amount ?? 0)
      if (je.source_type === 'tax_invoice') out.cogsInvoice[i] += v
      else if (je.source_type === 'card') out.cogsCard[i] += v
      else out.cogsOther[i] += v
    }
  }

  return { data: out }
}

// ── 매출 대사: 증빙 기준 vs ERP 기준 — 거래처별 차이 (2026-11-03) ─────────────
// ERP 순매출(v_erp_order_receivable.net_sales, 주문일) vs 매출 계산서 공급가액(작성일) + 현금영수증(사업자번호로 거래처 연결).
// 카드매출은 거래처 정보가 없어 거래처 대사에서 제외(월 합계 대사에는 포함).
export interface RevenueReconcileVendor {
  vendor_id: string | null
  vendor_name: string
  erp: number
  evidence: number
  diff: number
  erp_orders: number
  invoices: number
}

export async function buildRevenueReconcileByVendor(
  admin: SupabaseClient,
  dateFrom: string,
  dateTo: string,
  accounts: Map<string, { code: string; name: string; type: string }>,
  limit = 40,
): Promise<{ data: RevenueReconcileVendor[] } | { error: string }> {
  const agg = new Map<string, RevenueReconcileVendor>()
  const get = (vid: string | null, name: string) => {
    const k = vid ?? '__none__'
    let v = agg.get(k)
    if (!v) { v = { vendor_id: vid, vendor_name: name, erp: 0, evidence: 0, diff: 0, erp_orders: 0, invoices: 0 }; agg.set(k, v) }
    return v
  }

  const erpRes = await fetchAllRows<{ vendor_id: string | null; net_sales: number }>((f, t) =>
    admin.from('v_erp_order_receivable').select('vendor_id, net_sales')
      .gte('order_date', dateFrom).lte('order_date', dateTo).range(f, t))
  if ('error' in erpRes) return { error: erpRes.error }
  for (const r of erpRes.data) { const v = get(r.vendor_id, ''); v.erp += r.net_sales ?? 0; v.erp_orders++ }

  const invRes = await fetchAllRows<{ vendor_id: string | null; counterparty_name: string | null; supply_amount: number | null; total_amount: number | null; tax_amount: number | null; tax_type: string; confirmed_account_id: string | null }>((f, t) =>
    admin.from('tax_invoices').select('vendor_id, counterparty_name, supply_amount, total_amount, tax_amount, tax_type, confirmed_account_id')
      .eq('direction', 'sales').gte('issue_date', dateFrom).lte('issue_date', dateTo).range(f, t))
  if ('error' in invRes) return { error: invRes.error }
  for (const r of invRes.data) {
    const acc = r.confirmed_account_id ? accounts.get(r.confirmed_account_id) : null
    if (acc && acc.type === 'income' && acc.code !== '4001') continue   // 임대료 등은 상품 매출 대사 대상 아님
    const v = get(r.vendor_id, r.counterparty_name ?? '')
    v.evidence += r.tax_type === 'exempt' ? (r.supply_amount || r.total_amount || 0) : supplyOf(r.supply_amount, r.total_amount, r.tax_amount)
    v.invoices++
  }

  // 거래처 이름 보충
  const ids = Array.from(agg.keys()).filter(k => k !== '__none__')
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const { data } = await admin.from('vendors').select('id, name').in('id', chunk)
    for (const v of data ?? []) { const a = agg.get(v.id as string); if (a) a.vendor_name = v.name as string }
  }
  const none = agg.get('__none__'); if (none) none.vendor_name = '(거래처 미연결)'

  const list = Array.from(agg.values()).map(v => ({ ...v, diff: v.erp - v.evidence }))
    .filter(v => v.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, limit)
  return { data: list }
}
