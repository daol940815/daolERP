import type { SupabaseClient } from '@supabase/supabase-js'

export interface ErpSpecialItemRow {
  id: string
  order_no: string
  order_date: string | null
  customer_name: string
  item_name: string | null
  sale_price: number
  quantity: number
  line_total: number
  is_canceled: boolean
}

export interface ErpSpecialLedgerRow {
  id: string
  entry_date: string
  entry_type: 'deposit' | 'deduction'
  amount: number
  customer_name: string
  memo: string | null
}

export interface ErpSpecialBalanceRow {
  alias_id: string
  customer_name: string
  deposit_total: number
  deduction_total: number
  balance: number
}

export interface ErpSpecialData {
  vip_items: ErpSpecialItemRow[]
  prepay_items: ErpSpecialItemRow[]
  ledger: ErpSpecialLedgerRow[]
  balances: ErpSpecialBalanceRow[]
}

interface JoinedOrder {
  order_no?: string
  order_date?: string | null
  bank_name?: string | null
  branch_name?: string | null
}

// ── VIP 품목 + 매출처 선결제 원장/잔액 집계 ─────────────
// from/to는 VIP·선결제 품목(주문일)과 원장(입출일)에 적용, 잔액은 전체 기간 기준
export async function buildErpSpecialData(
  admin: SupabaseClient,
  from: string | null,
  to: string | null,
): Promise<ErpSpecialData | { error: string }> {

  const fetchItems = async (
    flagCol: 'is_vip' | 'is_prepayment',
  ): Promise<{ rows: ErpSpecialItemRow[] } | { error: string }> => {
    let q = admin
      .from('erp_order_items')
      .select('id, item_name, sale_price, quantity, line_total, is_canceled, erp_orders!inner(order_no, order_date, bank_name, branch_name)')
      .eq(flagCol, true)
      .limit(10000)
    if (from) q = q.gte('erp_orders.order_date', from)
    if (to)   q = q.lte('erp_orders.order_date', to)
    const { data, error } = await q
    if (error) return { error: error.message }
    const rows: ErpSpecialItemRow[] = (data ?? []).map(it => {
      const o = (it.erp_orders ?? {}) as JoinedOrder
      return {
        id: it.id as string,
        order_no: o.order_no ?? '-',
        order_date: o.order_date ?? null,
        customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' ') || '-',
        item_name: (it.item_name as string | null) ?? null,
        sale_price: (it.sale_price as number) || 0,
        quantity: (it.quantity as number) || 0,
        line_total: (it.line_total as number) || 0,
        is_canceled: !!it.is_canceled,
      }
    })
    rows.sort((a, b) => (b.order_date ?? '').localeCompare(a.order_date ?? '') || a.order_no.localeCompare(b.order_no))
    return { rows }
  }

  const vip = await fetchItems('is_vip')
  if ('error' in vip) return { error: vip.error }
  const prepay = await fetchItems('is_prepayment')
  if ('error' in prepay) return { error: prepay.error }

  // 선결제 원장 전체 (잔액은 전체 기간으로 계산해야 정확)
  const { data: entries, error: le } = await admin
    .from('erp_prepayments')
    .select('id, entry_date, entry_type, amount, memo, alias_id, erp_vendor_aliases(erp_name)')
    .eq('direction', 'customer')
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10000)
  if (le) return { error: le.message }

  const balanceMap = new Map<string, ErpSpecialBalanceRow>()
  const ledger: ErpSpecialLedgerRow[] = []
  for (const e of entries ?? []) {
    const aliasId = e.alias_id as string
    const name = ((e.erp_vendor_aliases as { erp_name?: string } | null)?.erp_name) ?? '매출처 미지정'
    let b = balanceMap.get(aliasId)
    if (!b) {
      b = { alias_id: aliasId, customer_name: name, deposit_total: 0, deduction_total: 0, balance: 0 }
      balanceMap.set(aliasId, b)
    }
    const amt = (e.amount as number) || 0
    if (e.entry_type === 'deposit') { b.deposit_total += amt; b.balance += amt }
    else { b.deduction_total += amt; b.balance -= amt }

    const d = e.entry_date as string
    if ((!from || d >= from) && (!to || d <= to)) {
      ledger.push({
        id: e.id as string,
        entry_date: d,
        entry_type: e.entry_type as 'deposit' | 'deduction',
        amount: amt,
        customer_name: name,
        memo: (e.memo as string | null) ?? null,
      })
    }
  }

  const balances = Array.from(balanceMap.values())
  balances.sort((a, b) => b.balance - a.balance || a.customer_name.localeCompare(b.customer_name, 'ko'))

  return { vip_items: vip.rows, prepay_items: prepay.rows, ledger, balances }
}
