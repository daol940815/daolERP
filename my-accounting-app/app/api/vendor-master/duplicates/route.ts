import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { normalizeMasterName } from '@/lib/vendor-master'

export const dynamic = 'force-dynamic'

// GET /api/vendor-master/duplicates
// 이름 정규화(정책 §3) 기준의 중복 후보 그룹을 제시한다. 병합은 사용자 승인 후에만(§6).
export async function GET() {
  const admin = createAdminClient()

  // ── ERP 별칭 (병합되지 않은 것만) ──
  const aliasesResult = await fetchAllRows<{
    id: string; erp_name: string; alias_type: string; merged_into_alias_id: string | null
  }>((f, t) => admin
    .from('erp_vendor_aliases')
    .select('id, erp_name, alias_type, merged_into_alias_id')
    .is('merged_into_alias_id', null)
    .range(f, t))
  if ('error' in aliasesResult) return NextResponse.json({ error: aliasesResult.error }, { status: 500 })

  // 별칭별 사용 통계 (판단 근거)
  const orderStats = new Map<string, { count: number; amount: number }>()
  {
    const r = await fetchAllRows<{ customer_alias_id: string | null; total_amount: number | null }>((f, t) =>
      admin.from('erp_orders').select('customer_alias_id, total_amount').range(f, t))
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
    for (const o of r.data) {
      if (!o.customer_alias_id) continue
      const s = orderStats.get(o.customer_alias_id) ?? { count: 0, amount: 0 }
      s.count += 1; s.amount += o.total_amount ?? 0
      orderStats.set(o.customer_alias_id, s)
    }
  }
  const itemStats = new Map<string, { count: number; amount: number }>()
  {
    const r = await fetchAllRows<{ purchase_alias_id: string | null; purchase_total: number | null }>((f, t) =>
      admin.from('erp_order_items').select('purchase_alias_id, purchase_total').range(f, t))
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
    for (const it of r.data) {
      if (!it.purchase_alias_id) continue
      const s = itemStats.get(it.purchase_alias_id) ?? { count: 0, amount: 0 }
      s.count += 1; s.amount += it.purchase_total ?? 0
      itemStats.set(it.purchase_alias_id, s)
    }
  }

  const aliasGroups: Record<string, unknown[]> = { customer: [], purchase: [] }
  for (const type of ['customer', 'purchase'] as const) {
    const groups = new Map<string, typeof aliasesResult.data>()
    for (const a of aliasesResult.data.filter(x => x.alias_type === type)) {
      const k = normalizeMasterName(a.erp_name)
      if (!k) continue
      const g = groups.get(k) ?? []
      g.push(a); groups.set(k, g)
    }
    const stats = type === 'customer' ? orderStats : itemStats
    for (const [, g] of Array.from(groups.entries())) {
      if (g.length < 2) continue
      const members = g
        .map(a => ({ id: a.id, name: a.erp_name, ...(stats.get(a.id) ?? { count: 0, amount: 0 }) }))
        .sort((x, y) => y.count - x.count || y.amount - x.amount)
      aliasGroups[type].push({ members })
    }
    ;(aliasGroups[type] as { members: { amount: number }[] }[])
      .sort((a, b) => b.members.reduce((s, m) => s + m.amount, 0) - a.members.reduce((s, m) => s + m.amount, 0))
  }

  // ── 거래처(vendors, active만) ──
  const vendorsResult = await fetchAllRows<{ id: string; name: string; type: string; biz_number: string | null; status: string }>((f, t) =>
    admin.from('vendors').select('id, name, type, biz_number, status').eq('status', 'active').range(f, t))
  if ('error' in vendorsResult) return NextResponse.json({ error: vendorsResult.error }, { status: 500 })
  const vGroups = new Map<string, typeof vendorsResult.data>()
  for (const v of vendorsResult.data) {
    const k = normalizeMasterName(v.name)
    if (!k) continue
    const g = vGroups.get(k) ?? []
    g.push(v); vGroups.set(k, g)
  }
  const vendorGroups = Array.from(vGroups.values())
    .filter(g => g.length > 1)
    .map(g => ({ members: g.map(v => ({ id: v.id, name: v.name, type: v.type, biz_number: v.biz_number })) }))

  return NextResponse.json({
    alias_customer: aliasGroups.customer,
    alias_purchase: aliasGroups.purchase,
    vendors: vendorGroups,
  })
}
