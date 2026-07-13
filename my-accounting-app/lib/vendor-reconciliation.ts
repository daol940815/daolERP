import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ERP 매출처/매입처명 단위 대조: ERP 매출/매입 vs 입출금·카드·현금영수증·세금계산서
//
// 행 구성:
//  - single   : 별칭 1개 ↔ 거래처 1개(또는 미연결 별칭, ERP 없는 결제전용 거래처) — 한 행에 전부 표시
//  - member   : 여러 별칭이 같은 거래처를 공유할 때의 개별 별칭 행 — ERP 금액만 (결제는 거래처 단위라 분리 불가)
//  - subtotal : 공유 거래처의 합계 행 — 그룹 ERP 합계 + 거래처 단위 결제·계산서, 차액은 여기서 판단
export interface ReconciliationRow {
  key: string
  kind: 'single' | 'member' | 'subtotal'
  group_key: string          // 같은 거래처를 공유하는 행 묶음 식별자
  erp_name: string           // ERP 매출처/매입처명 (subtotal·결제전용 행은 거래처명)
  vendor_id: string | null
  vendor_name: string | null // 연결 거래처명 (미연결이면 null)
  has_payment: boolean       // false면 결제·차액 칸을 표시하지 않음 (member, 미연결)
  erp_amount: number         // sales: 순매출(취소/VIP/선결제 제외) / purchase: 매입 합계
  erp_outstanding: number    // sales 전용: ERP 기준 미수금
  bank_amount: number        // sales: 입금 합계 / purchase: 출금 합계
  card_amount: number        // sales 전용: 카드매출 (취소 차감)
  cash_amount: number        // 현금영수증 (취소 차감)
  invoice_amount: number     // 세금계산서 합계
  payment_total: number      // bank + card + cash
  diff_payment: number       // erp_amount − payment_total
  diff_invoice: number       // erp_amount − invoice_amount
}

interface ErpAgg { amount: number; outstanding: number }
interface PayAgg { bank: number; card: number; cash: number; invoice: number }

type ErpAggFn = (aliasId: string) => ErpAgg

// ERP 금액(별칭 단위) 집계 — DB 집계 RPC 우선, 마이그레이션 037 미적용 시 앱-사이드 스캔 폴백.
async function loadReconcileErp(
  admin: SupabaseClient,
  direction: 'sales' | 'purchase',
  from: string | null,
  to: string | null,
  erpAgg: ErpAggFn,
): Promise<{ error: string } | null> {
  const fn = direction === 'sales' ? 'erp_reconcile_sales_by_alias' : 'erp_reconcile_purchase_by_alias'
  const resp = await admin.rpc(fn, { p_from: from, p_to: to })
  if (!resp.error) {
    for (const r of (resp.data ?? []) as { alias_id: string; amount: number | string; outstanding?: number | string }[]) {
      const a = erpAgg(r.alias_id)
      a.amount += Number(r.amount) || 0
      if (direction === 'sales') a.outstanding += Number(r.outstanding) || 0
    }
    return null
  }
  const missing = resp.error.code === 'PGRST202' || new RegExp(fn).test(resp.error.message ?? '')
  if (!missing) return { error: resp.error.message }
  return loadReconcileErpFallback(admin, direction, from, to, erpAgg)
}

async function loadReconcileErpFallback(
  admin: SupabaseClient,
  direction: 'sales' | 'purchase',
  from: string | null,
  to: string | null,
  erpAgg: ErpAggFn,
): Promise<{ error: string } | null> {
  if (direction === 'sales') {
    const ordersResult = await fetchAllRows<{
      id: string
      customer_alias_id: string
      total_amount: number | null
      outstanding_amount: number | null
      collect_status: string
    }>((rFrom, rTo) => {
      let oq = admin
        .from('erp_orders')
        .select('id, customer_alias_id, total_amount, outstanding_amount, collect_status')
        .not('customer_alias_id', 'is', null)
      if (from) oq = oq.gte('order_date', from)
      if (to)   oq = oq.lte('order_date', to)
      return oq.range(rFrom, rTo)
    })
    if ('error' in ordersResult) return { error: ordersResult.error }
    const orders = ordersResult.data

    const orderIds = orders.map(o => o.id)
    const excludedByOrder = new Map<string, number>()
    for (let i = 0; i < orderIds.length; i += 500) {
      const idChunk = orderIds.slice(i, i + 500)
      const itemsResult = await fetchAllRows<{ order_id: string; line_total: number | null }>((rFrom, rTo) =>
        admin
          .from('erp_order_items')
          .select('order_id, line_total')
          .in('order_id', idChunk)
          .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
          .range(rFrom, rTo),
      )
      if ('error' in itemsResult) return { error: itemsResult.error }
      for (const it of itemsResult.data) {
        const cur = excludedByOrder.get(it.order_id) ?? 0
        excludedByOrder.set(it.order_id, cur + ((it.line_total as number) || 0))
      }
    }
    for (const o of orders) {
      const a = erpAgg(o.customer_alias_id)
      a.amount += ((o.total_amount as number) || 0) - (excludedByOrder.get(o.id) ?? 0)
      if (o.collect_status !== 'collected') a.outstanding += (o.outstanding_amount as number) || 0
    }
  } else {
    const itemsResult = await fetchAllRows<{ purchase_alias_id: string; purchase_total: number | null }>((rFrom, rTo) => {
      let iq = admin
        .from('erp_order_items')
        .select('purchase_alias_id, purchase_total, erp_orders!inner(order_date)')
        .eq('is_canceled', false)
        .eq('is_vip', false)
        .eq('is_prepayment', false)
        .not('purchase_alias_id', 'is', null)
      if (from) iq = iq.gte('erp_orders.order_date', from)
      if (to)   iq = iq.lte('erp_orders.order_date', to)
      return iq.range(rFrom, rTo)
    })
    if ('error' in itemsResult) return { error: itemsResult.error }
    for (const it of itemsResult.data) {
      erpAgg(it.purchase_alias_id).amount += (it.purchase_total as number) || 0
    }
  }
  return null
}

export async function buildReconciliationRows(
  admin: SupabaseClient,
  direction: 'sales' | 'purchase',
  from: string | null,
  to: string | null,
): Promise<{ rows: ReconciliationRow[] } | { error: string }> {

  // 별칭 전체 (미연결 포함 — ERP 기준으로 빠짐없이 보여준다)
  const aliasesResult = await fetchAllRows<{ id: string; erp_name: string; vendor_id: string | null }>((from, to) =>
    admin
      .from('erp_vendor_aliases')
      .select('id, erp_name, vendor_id')
      .eq('alias_type', direction === 'sales' ? 'customer' : 'purchase')
      .range(from, to),
  )
  if ('error' in aliasesResult) return { error: aliasesResult.error }
  const aliases = aliasesResult.data

  const vendorRowsResult = await fetchAllRows<{ id: string; name: string }>((from, to) =>
    admin.from('vendors').select('id, name').range(from, to),
  )
  if ('error' in vendorRowsResult) return { error: vendorRowsResult.error }
  const vendorName = new Map(vendorRowsResult.data.map(v => [v.id, v.name]))

  // ── 1) ERP 금액 (별칭 단위) ─────────────────────────
  const erpByAlias = new Map<string, ErpAgg>()
  const erpAgg = (aliasId: string): ErpAgg => {
    let a = erpByAlias.get(aliasId)
    if (!a) { a = { amount: 0, outstanding: 0 }; erpByAlias.set(aliasId, a) }
    return a
  }

  // ERP 금액 집계: DB 집계 RPC 우선, 마이그레이션 037 미적용 시 앱-사이드 스캔 폴백
  const erpErr = await loadReconcileErp(admin, direction, from, to, erpAgg)
  if (erpErr) return erpErr

  // ── 2) 결제·계산서 (거래처 단위) ─────────────────────
  const payByVendor = new Map<string, PayAgg>()
  const payAgg = (vendorId: string): PayAgg => {
    let p = payByVendor.get(vendorId)
    if (!p) { p = { bank: 0, card: 0, cash: 0, invoice: 0 }; payByVendor.set(vendorId, p) }
    return p
  }

  // 은행 입출금
  {
    const txResult = await fetchAllRows<{ vendor_id: string; amount_in: number | null; amount_out: number | null }>((rFrom, rTo) => {
      let tq = admin
        .from('transactions')
        .select('vendor_id, amount_in, amount_out')
        .not('vendor_id', 'is', null)
      if (from) tq = tq.gte('tx_date', from)
      if (to)   tq = tq.lte('tx_date', to)
      tq = direction === 'sales' ? tq.gt('amount_in', 0) : tq.gt('amount_out', 0)
      return tq.range(rFrom, rTo)
    })
    if ('error' in txResult) return { error: txResult.error }
    for (const t of txResult.data) {
      const amt = direction === 'sales' ? ((t.amount_in as number) || 0) : ((t.amount_out as number) || 0)
      payAgg(t.vendor_id).bank += amt
    }
  }

  // 카드매출 (매출 대조 전용, 취소 차감)
  if (direction === 'sales') {
    const cardsResult = await fetchAllRows<{ vendor_id: string; amount: number | null; transaction_type: string }>((rFrom, rTo) => {
      let cq = admin
        .from('card_sales')
        .select('vendor_id, amount, transaction_type')
        .not('vendor_id', 'is', null)
      if (from) cq = cq.gte('tx_date', from)
      if (to)   cq = cq.lte('tx_date', to)
      return cq.range(rFrom, rTo)
    })
    if ('error' in cardsResult) return { error: cardsResult.error }
    for (const c of cardsResult.data) {
      const amt = (c.amount as number) || 0
      payAgg(c.vendor_id).card += c.transaction_type === 'cancel' ? -Math.abs(amt) : amt
    }
  }

  // 현금영수증 (취소 차감)
  {
    const receiptsResult = await fetchAllRows<{ vendor_id: string; amount: number | null; transaction_type: string }>((rFrom, rTo) => {
      let rq = admin
        .from('cash_receipts')
        .select('vendor_id, amount, transaction_type')
        .eq('direction', direction)
        .not('vendor_id', 'is', null)
      if (from) rq = rq.gte('tx_date', from)
      if (to)   rq = rq.lte('tx_date', to)
      return rq.range(rFrom, rTo)
    })
    if ('error' in receiptsResult) return { error: receiptsResult.error }
    for (const c of receiptsResult.data) {
      const amt = (c.amount as number) || 0
      payAgg(c.vendor_id).cash += c.transaction_type === 'cancel' ? -Math.abs(amt) : amt
    }
  }

  // 세금계산서
  {
    const invoicesResult = await fetchAllRows<{ vendor_id: string; total_amount: number | null }>((rFrom, rTo) => {
      let xq = admin
        .from('tax_invoices')
        .select('vendor_id, total_amount')
        .eq('direction', direction)
        .not('vendor_id', 'is', null)
      if (from) xq = xq.gte('issue_date', from)
      if (to)   xq = xq.lte('issue_date', to)
      return xq.range(rFrom, rTo)
    })
    if ('error' in invoicesResult) return { error: invoicesResult.error }
    for (const inv of invoicesResult.data) {
      payAgg(inv.vendor_id).invoice += (inv.total_amount as number) || 0
    }
  }

  // ── 3) 행 조립 ──────────────────────────────────────
  const makeRow = (init: Partial<ReconciliationRow> & Pick<ReconciliationRow, 'key' | 'kind' | 'group_key' | 'erp_name'>): ReconciliationRow => ({
    vendor_id: null, vendor_name: null, has_payment: false,
    erp_amount: 0, erp_outstanding: 0,
    bank_amount: 0, card_amount: 0, cash_amount: 0, invoice_amount: 0,
    payment_total: 0, diff_payment: 0, diff_invoice: 0,
    ...init,
  })
  const applyPay = (r: ReconciliationRow, p: PayAgg | undefined) => {
    r.bank_amount    = p?.bank ?? 0
    r.card_amount    = p?.card ?? 0
    r.cash_amount    = p?.cash ?? 0
    r.invoice_amount = p?.invoice ?? 0
    r.payment_total  = r.bank_amount + r.card_amount + r.cash_amount
    r.diff_payment   = r.erp_amount - r.payment_total
    r.diff_invoice   = r.erp_amount - r.invoice_amount
    r.has_payment    = true
  }

  // 거래처별 별칭 묶음 / 미연결 별칭
  const aliasesByVendor = new Map<string, { id: string; erp_name: string }[]>()
  const unlinked: { id: string; erp_name: string }[] = []
  for (const a of aliases ?? []) {
    const item = { id: a.id as string, erp_name: a.erp_name as string }
    if (a.vendor_id) {
      const list = aliasesByVendor.get(a.vendor_id as string) ?? []
      list.push(item)
      aliasesByVendor.set(a.vendor_id as string, list)
    } else {
      unlinked.push(item)
    }
  }

  // 정렬 단위(unit): single 1행 또는 member들+subtotal 묶음
  const units: { sortVal: number; rows: ReconciliationRow[] }[] = []

  for (const [vendorId, list] of Array.from(aliasesByVendor.entries())) {
    const vName = vendorName.get(vendorId) ?? '(삭제된 거래처)'
    const pay = payByVendor.get(vendorId)
    payByVendor.delete(vendorId)

    if (list.length === 1) {
      const a = list[0]
      const e = erpByAlias.get(a.id)
      const r = makeRow({
        key: a.id, kind: 'single', group_key: a.id, erp_name: a.erp_name,
        vendor_id: vendorId, vendor_name: vName,
        erp_amount: e?.amount ?? 0, erp_outstanding: e?.outstanding ?? 0,
      })
      applyPay(r, pay)
      if (r.erp_amount === 0 && r.erp_outstanding === 0 && r.payment_total === 0 && r.invoice_amount === 0) continue
      units.push({ sortVal: Math.abs(r.diff_payment), rows: [r] })
    } else {
      // 여러 ERP 매출처가 한 거래처 공유 (예: 하나은행 경영지원부/영업지원부 → 하나은행 본점)
      const members = list
        .map(a => {
          const e = erpByAlias.get(a.id)
          return makeRow({
            key: a.id, kind: 'member', group_key: vendorId, erp_name: a.erp_name,
            vendor_id: vendorId, vendor_name: vName,
            erp_amount: e?.amount ?? 0, erp_outstanding: e?.outstanding ?? 0,
          })
        })
        .filter(r => r.erp_amount !== 0 || r.erp_outstanding !== 0)
        .sort((a, b) => b.erp_amount - a.erp_amount)
      const sub = makeRow({
        key: `sub:${vendorId}`, kind: 'subtotal', group_key: vendorId, erp_name: vName,
        vendor_id: vendorId, vendor_name: vName,
        erp_amount: members.reduce((s, r) => s + r.erp_amount, 0),
        erp_outstanding: members.reduce((s, r) => s + r.erp_outstanding, 0),
      })
      applyPay(sub, pay)
      if (members.length === 0 && sub.payment_total === 0 && sub.invoice_amount === 0) continue
      units.push({ sortVal: Math.abs(sub.diff_payment), rows: [...members, sub] })
    }
  }

  // 거래처 미연결 별칭 — ERP 금액만 표시 (매칭 누락 확인용)
  for (const a of unlinked) {
    const e = erpByAlias.get(a.id)
    if (!e || (e.amount === 0 && e.outstanding === 0)) continue
    const r = makeRow({
      key: a.id, kind: 'single', group_key: a.id, erp_name: a.erp_name,
      erp_amount: e.amount, erp_outstanding: e.outstanding,
    })
    units.push({ sortVal: r.erp_amount, rows: [r] })
  }

  // 결제·계산서만 있고 이 방향 ERP 별칭이 없는 거래처
  for (const [vendorId, pay] of Array.from(payByVendor.entries())) {
    const r = makeRow({
      key: `pay:${vendorId}`, kind: 'single', group_key: `pay:${vendorId}`,
      erp_name: vendorName.get(vendorId) ?? '(삭제된 거래처)',
      vendor_id: vendorId, vendor_name: vendorName.get(vendorId) ?? '(삭제된 거래처)',
    })
    applyPay(r, pay)
    if (r.payment_total === 0 && r.invoice_amount === 0) continue
    units.push({ sortVal: Math.abs(r.diff_payment), rows: [r] })
  }

  units.sort((a, b) => b.sortVal - a.sortVal)
  return { rows: units.flatMap(u => u.rows) }
}
