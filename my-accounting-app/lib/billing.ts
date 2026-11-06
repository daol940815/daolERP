import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// ─────────────────────────────────────────────────────────
// 청구처(계산서 발행처) — 114 vendors.billing_vendor_id (2026-11-06 사용자 승인)
//
// 부서(매출처)는 고객 관리 단위로 그대로 두고, 계산서를 받는 법인을 청구처로 가리킨다.
// 예: 하나은행 영업지원그룹 → 주식회사 하나은행. 비어 있으면 자기 자신이 청구처.
// "청구처 가족" = 청구처 법인 + 그 법인을 가리키는 매출처들. 주문 ↔ 계산서 연결 추천은
// 이 가족 범위에서 찾는다(본점 계산서에는 부서 정보가 없어 주문 연결이 유일한 단서).
// 114 미적용 환경: 모든 함수가 "청구처 없음"으로 동작한다(기존 화면 그대로).
// ─────────────────────────────────────────────────────────

export interface BillingRef { id: string; name: string; biz_number: string | null }

// 매출처 하나의 청구처 + (청구처 법인이면) 소속 매출처
export async function loadBillingFamily(admin: SupabaseClient, vendorId: string): Promise<{
  available: boolean
  billing: BillingRef | null          // 이 매출처가 가리키는 청구처 (없으면 null = 자기 자신)
  root: string                        // 청구처 가족의 법인 id
  members: string[]                   // 가족 전체 (법인 포함)
  children: { id: string; name: string }[]   // 이 매출처를 청구처로 가리키는 매출처 (법인일 때)
  self_confirmed: boolean
}> {
  const empty = { available: false, billing: null, root: vendorId, members: [vendorId], children: [], self_confirmed: false }
  const { data: me, error } = await admin.from('vendors')
    .select('id, billing_vendor_id, billing_self_confirmed').eq('id', vendorId).maybeSingle()
  if (error || !me) return empty
  const rootId = (me.billing_vendor_id as string | null) ?? vendorId
  const [{ data: root }, { data: kids }] = await Promise.all([
    me.billing_vendor_id
      ? admin.from('vendors').select('id, name, biz_number').eq('id', rootId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('vendors').select('id, name').eq('billing_vendor_id', rootId).neq('status', 'merged'),
  ])
  const children = ((kids ?? []) as { id: string; name: string }[])
  return {
    available: true,
    billing: root ? { id: root.id as string, name: root.name as string, biz_number: (root.biz_number as string | null) ?? null } : null,
    root: rootId,
    members: Array.from(new Set([rootId, ...children.map(c => c.id)])),
    children: me.billing_vendor_id ? [] : children,
    self_confirmed: !!me.billing_self_confirmed,
  }
}

// 매출처 id → 청구처 {id, name} (목록 · 미수금 관리의 '청구처 기준' 묶음용). 114 미적용이면 빈 맵.
export async function loadBillingMap(admin: SupabaseClient): Promise<Map<string, { id: string; name: string }>> {
  const m = new Map<string, { id: string; name: string }>()
  const r = await fetchAllRows<{ id: string; billing_vendor_id: string | null }>((f, t) =>
    admin.from('vendors').select('id, billing_vendor_id').not('billing_vendor_id', 'is', null).range(f, t))
  if ('error' in r || !r.data.length) return m
  const rootIds = Array.from(new Set(r.data.map(v => v.billing_vendor_id as string)))
  const names = new Map<string, string>()
  for (let i = 0; i < rootIds.length; i += 150) {
    const { data } = await admin.from('vendors').select('id, name').in('id', rootIds.slice(i, i + 150))
    for (const v of data ?? []) names.set(v.id as string, v.name as string)
  }
  for (const v of r.data) {
    const id = v.billing_vendor_id as string
    m.set(v.id, { id, name: names.get(id) ?? '(청구처)' })
  }
  return m
}

// ── 청구처 지정 추천 ──────────────────────────────────────
// 업체(vendor_groups)마다 "본점 법인" = 업체명과 같은 이름(법인 접두 무시)이면서 사업자번호가 있는 거래처.
// 그 업체 소속 매출처 중 자체 사업자번호 · 자체 매출 계산서가 모두 없는 곳을 추천한다.
// 이름이 지점형(…지점 · 출장소)이거나 센터면 자체 발행일 수 있어 기본 체크하지 않는다(주의 표시).

const normName = (s: string) =>
  s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '').replace(/\s*(\(주\)|㈜|주식회사)\s*$/, '').replace(/\s+/g, '').toLowerCase()

// 기본 체크하지 않을 이유 (2026-11-06 실데이터 시뮬레이션으로 보강 — 매장 · 지사 · 별도 단체 · 같은 이름 중복)
function cautionOf(name: string, short: string, entityName: string): string | null {
  if (!short || normName(name) === normName(entityName)) return '이름이 법인과 같음 — 중복 거래처면 병합 검토'
  if (/(지점|출장소)$/.test(short)) return '지점 — 자체 발행일 수 있음'
  if (/점$/.test(short)) return '매장 · 점포 — 별도 사업자일 수 있음'
  if (/지사$/.test(short)) return '지사 — 자체 발행일 수 있음'
  if (/센터/.test(short)) return '센터 — 자체 발행일 수 있음'
  if (/(노동조합|조합|동우회|동창회|바자회|협회|친목회)/.test(short)) return '별도 단체일 수 있음'
  return null
}

export interface BillingSuggestion {
  vendor_id: string
  vendor_name: string
  entity_id: string
  entity_name: string
  entity_biz: string | null
  group_name: string
  staff: string | null
  reasons: string[]
  caution: string | null      // 기본 체크하지 않는 이유
}

export async function buildBillingSuggestions(admin: SupabaseClient): Promise<{
  available: boolean
  suggestions: BillingSuggestion[]
  linked: { vendor_id: string; vendor_name: string; entity_id: string; entity_name: string }[]
  self_count: number
} | { error: string }> {
  const probe = await admin.from('vendors').select('billing_vendor_id').limit(1)
  if (probe.error) return { available: false, suggestions: [], linked: [], self_count: 0 }

  const [vr, gr, ir, sr] = await Promise.all([
    fetchAllRows<{ id: string; name: string; biz_number: string | null; group_id: string | null; type: string | null; status: string | null; is_active: boolean | null; billing_vendor_id: string | null; billing_self_confirmed: boolean | null }>((f, t) =>
      admin.from('vendors').select('id, name, biz_number, group_id, type, status, is_active, billing_vendor_id, billing_self_confirmed')
        .neq('status', 'merged').range(f, t)),
    fetchAllRows<{ id: string; name: string }>((f, t) => admin.from('vendor_groups').select('id, name').range(f, t)),
    fetchAllRows<{ vendor_id: string | null }>((f, t) =>
      admin.from('tax_invoices').select('vendor_id').eq('direction', 'sales').not('vendor_id', 'is', null).range(f, t)),
    fetchAllRows<{ vendor_id: string; is_primary: boolean; employees: unknown }>((f, t) =>
      admin.from('vendor_staff').select('vendor_id, is_primary, employees(name)').is('ended_at', null).range(f, t)),
  ])
  if ('error' in vr) return { error: vr.error }
  if ('error' in gr) return { error: gr.error }
  if ('error' in ir) return { error: ir.error }
  const invCount = new Map<string, number>()
  for (const t of ir.data) if (t.vendor_id) invCount.set(t.vendor_id, (invCount.get(t.vendor_id) ?? 0) + 1)
  const staff = new Map<string, string>()
  if (!('error' in sr)) {
    for (const s of sr.data) {
      const n = (s.employees as { name?: string } | null)?.name
      if (n && (s.is_primary || !staff.has(s.vendor_id))) staff.set(s.vendor_id, n)
    }
  }

  const vendors = vr.data
  const byId = new Map(vendors.map(v => [v.id, v]))
  // 본점 법인 후보: 사업자번호 + 자체 매출 계산서가 있는 거래처, 정규화 이름 → 거래처
  const entityByName = new Map<string, typeof vendors[number]>()
  for (const v of vendors) {
    if (!v.biz_number || !invCount.get(v.id)) continue
    const k = normName(v.name)
    const cur = entityByName.get(k)
    if (!cur || (invCount.get(v.id) ?? 0) > (invCount.get(cur.id) ?? 0)) entityByName.set(k, v)
  }
  const groupName = new Map(gr.data.map(g => [g.id, g.name]))

  const suggestions: BillingSuggestion[] = []
  for (const v of vendors) {
    if (v.is_active === false || !(v.type === 'customer' || v.type === 'both')) continue
    if (v.billing_vendor_id || v.billing_self_confirmed || !v.group_id) continue
    if (v.biz_number || invCount.get(v.id)) continue
    const gName = groupName.get(v.group_id)
    if (!gName) continue
    const entity = entityByName.get(normName(gName))
    if (!entity || entity.id === v.id || entity.billing_vendor_id) continue
    const short = v.name.replace(gName, '').trim()
    const caution = cautionOf(v.name, short, entity.name)
    suggestions.push({
      vendor_id: v.id, vendor_name: v.name,
      entity_id: entity.id, entity_name: entity.name, entity_biz: entity.biz_number,
      group_name: gName, staff: staff.get(v.id) ?? null,
      reasons: ['자체 계산서 없음', '사업자번호 없음', ...(caution ? [] : ['부서형 이름'])],
      caution,
    })
  }
  suggestions.sort((a, b) => a.group_name.localeCompare(b.group_name, 'ko')
    || Number(!!a.caution) - Number(!!b.caution) || a.vendor_name.localeCompare(b.vendor_name, 'ko'))

  const linked = vendors.filter(v => v.billing_vendor_id).map(v => ({
    vendor_id: v.id, vendor_name: v.name,
    entity_id: v.billing_vendor_id as string, entity_name: byId.get(v.billing_vendor_id as string)?.name ?? '(청구처)',
  })).sort((a, b) => a.entity_name.localeCompare(b.entity_name, 'ko') || a.vendor_name.localeCompare(b.vendor_name, 'ko'))

  return {
    available: true, suggestions, linked,
    self_count: vendors.filter(v => v.billing_self_confirmed).length,
  }
}

// 청구처로 고를 수 있는 법인 목록 (사업자번호가 있고 다른 청구처를 가리키지 않는 거래처)
export async function listBillingEntities(admin: SupabaseClient, q: string): Promise<BillingRef[]> {
  const key = q.replace(/\s+/g, '')
  let query = admin.from('vendors').select('id, name, biz_number')
    .not('biz_number', 'is', null).neq('status', 'merged').is('billing_vendor_id', null)
    .order('name').limit(30)
  if (key) query = query.ilike('name', `%${q.trim()}%`)
  const { data, error } = await query
  if (error) return []
  return (data ?? []).map(v => ({ id: v.id as string, name: v.name as string, biz_number: (v.biz_number as string | null) ?? null }))
}

// ── 360° 상세용 청구처 데이터 ─────────────────────────────
// 부서(청구처 지정됨): 이 부서 주문에 연결된 청구처 법인 계산서 목록 + 그 주문 id
// 청구처 법인(소속 있음): 법인 계산서별 연결 부서 · 주문, 소속 부서별 기간 요약

export interface BillingDetail {
  available: boolean
  billing: BillingRef | null
  self_confirmed: boolean
  via_invoices: {
    id: string; issue_date: string; item_name: string | null; total_amount: number
    payment_status: string; order_no: string | null; amount: number
  }[]
  via_order_ids: string[]
  children: {
    vendor_id: string; vendor_name: string; staff: string | null
    net: number; linked: number; unissued: number; outstanding: number
  }[]
  invoice_links: Record<string, { order_no: string | null; vendor_id: string; vendor_name: string; amount: number }[]>
}

export async function buildBillingDetail(
  admin: SupabaseClient, vendorId: string, fromDate: string | null, toDate: string | null,
): Promise<BillingDetail> {
  const fam = await loadBillingFamily(admin, vendorId)
  const out: BillingDetail = {
    available: fam.available, billing: fam.billing, self_confirmed: fam.self_confirmed,
    via_invoices: [], via_order_ids: [], children: [], invoice_links: {},
  }
  if (!fam.available) return out

  const ordersOf = async (vendorIds: string[], period: boolean) => {
    const aliasVendor = new Map<string, string>()
    for (let i = 0; i < vendorIds.length; i += 150) {
      const r = await fetchAllRows<{ id: string; vendor_id: string }>((f, t) =>
        admin.from('erp_vendor_aliases').select('id, vendor_id').eq('alias_type', 'customer')
          .in('vendor_id', vendorIds.slice(i, i + 150)).range(f, t))
      if (!('error' in r)) for (const a of r.data) aliasVendor.set(a.id, a.vendor_id)
    }
    const aliasIds = Array.from(aliasVendor.keys())
    const orders: { id: string; order_no: string | null; order_date: string; total_amount: number | null; outstanding_amount: number | null; vendor_id: string }[] = []
    for (let i = 0; i < aliasIds.length; i += 50) {
      const r = await fetchAllRows<{ id: string; order_no: string | null; order_date: string; total_amount: number | null; outstanding_amount: number | null; customer_alias_id: string }>((f, t) => {
        let q = admin.from('erp_orders').select('id, order_no, order_date, total_amount, outstanding_amount, customer_alias_id')
          .in('customer_alias_id', aliasIds.slice(i, i + 50))
        if (period && fromDate) q = q.gte('order_date', fromDate)
        if (period && toDate) q = q.lte('order_date', toDate)
        return q.range(f, t)
      })
      if (!('error' in r)) for (const o of r.data) orders.push({ ...o, vendor_id: aliasVendor.get(o.customer_alias_id) as string })
    }
    return orders
  }
  const linksOfOrders = async (orderIds: string[]) => {
    const links: { order_id: string; tax_invoice_id: string; amount: number }[] = []
    for (let i = 0; i < orderIds.length; i += 100) {
      const { data } = await admin.from('erp_order_invoices').select('order_id, tax_invoice_id, amount').in('order_id', orderIds.slice(i, i + 100))
      for (const l of data ?? []) links.push(l as { order_id: string; tax_invoice_id: string; amount: number })
    }
    return links
  }

  // 부서: 청구처 법인 계산서 중 이 부서 주문에 연결된 것
  if (fam.billing) {
    const orders = await ordersOf([vendorId], false)
    const orderNo = new Map(orders.map(o => [o.id, o.order_no]))
    const links = await linksOfOrders(orders.map(o => o.id))
    const invIds = Array.from(new Set(links.map(l => l.tax_invoice_id)))
    const invs = new Map<string, { id: string; issue_date: string; item_name: string | null; total_amount: number | null; payment_status: string; vendor_id: string }>()
    for (let i = 0; i < invIds.length; i += 100) {
      const { data } = await admin.from('tax_invoices').select('id, issue_date, item_name, total_amount, payment_status, vendor_id')
        .in('id', invIds.slice(i, i + 100))
      for (const t of data ?? []) invs.set(t.id as string, t as never)
    }
    const via = new Set<string>()
    for (const l of links) {
      const t = invs.get(l.tax_invoice_id)
      if (!t || t.vendor_id === vendorId) continue
      via.add(l.order_id)
      out.via_invoices.push({
        id: t.id, issue_date: t.issue_date, item_name: t.item_name, total_amount: t.total_amount ?? 0,
        payment_status: t.payment_status, order_no: orderNo.get(l.order_id) ?? null, amount: l.amount,
      })
    }
    out.via_invoices.sort((a, b) => b.issue_date.localeCompare(a.issue_date))
    out.via_order_ids = Array.from(via)
    return out
  }

  // 청구처 법인: 소속 부서 요약 + 법인 계산서별 연결 부서
  if (!fam.children.length) return out
  const childIds = fam.children.map(c => c.id)
  const childName = new Map(fam.children.map(c => [c.id, c.name]))

  const [summary, staffR] = await Promise.all([
    admin.rpc('hub_vendor_summary_json', { p_from: fromDate, p_to: toDate }),
    fetchAllRows<{ vendor_id: string; is_primary: boolean; employees: unknown }>((f, t) =>
      admin.from('vendor_staff').select('vendor_id, is_primary, employees(name)').in('vendor_id', childIds.slice(0, 150)).is('ended_at', null).range(f, t)),
  ])
  const sum = new Map<string, { net: number; outstanding: number }>()
  if (!summary.error && Array.isArray(summary.data)) {
    for (const r of summary.data as { vendor_id: string; net: number; outstanding: number }[]) sum.set(r.vendor_id, r)
  }
  const staff = new Map<string, string>()
  if (!('error' in staffR)) for (const s of staffR.data) {
    const n = (s.employees as { name?: string } | null)?.name
    if (n && (s.is_primary || !staff.has(s.vendor_id))) staff.set(s.vendor_id, n)
  }
  const periodOrders = await ordersOf(childIds, true)
  const periodLinks = await linksOfOrders(periodOrders.map(o => o.id))
  const linkedByOrder = new Map<string, number>()
  for (const l of periodLinks) linkedByOrder.set(l.order_id, (linkedByOrder.get(l.order_id) ?? 0) + l.amount)
  const linkedByVendor = new Map<string, number>()
  for (const o of periodOrders) {
    const s = sum.get(o.vendor_id)
    if (!s) continue
    linkedByVendor.set(o.vendor_id, (linkedByVendor.get(o.vendor_id) ?? 0) + (linkedByOrder.get(o.id) ?? 0))
  }
  out.children = childIds.map(id => {
    const s = sum.get(id) ?? { net: 0, outstanding: 0 }
    const linked = Math.min(linkedByVendor.get(id) ?? 0, s.net)
    return {
      vendor_id: id, vendor_name: childName.get(id) ?? '', staff: staff.get(id) ?? null,
      net: s.net, linked, unissued: Math.max(0, s.net - linked), outstanding: s.outstanding,
    }
  }).sort((a, b) => b.net - a.net || a.vendor_name.localeCompare(b.vendor_name, 'ko'))

  // 법인 계산서 → 연결된 주문 (어느 부서 건인가)
  const invR = await fetchAllRows<{ id: string }>((f, t) =>
    admin.from('tax_invoices').select('id').eq('direction', 'sales').eq('vendor_id', vendorId).range(f, t))
  const invIds = 'error' in invR ? [] : invR.data.map(t => t.id)
  const allLinks: { order_id: string; tax_invoice_id: string; amount: number }[] = []
  for (let i = 0; i < invIds.length; i += 100) {
    const { data } = await admin.from('erp_order_invoices').select('order_id, tax_invoice_id, amount').in('tax_invoice_id', invIds.slice(i, i + 100))
    for (const l of data ?? []) allLinks.push(l as { order_id: string; tax_invoice_id: string; amount: number })
  }
  const linkedOrderIds = Array.from(new Set(allLinks.map(l => l.order_id)))
  const orderInfo = new Map<string, { order_no: string | null; vendor_id: string }>()
  for (let i = 0; i < linkedOrderIds.length; i += 100) {
    const { data } = await admin.from('erp_orders').select('id, order_no, customer_alias_id').in('id', linkedOrderIds.slice(i, i + 100))
    const aliasIds = Array.from(new Set((data ?? []).map(o => o.customer_alias_id as string).filter(Boolean)))
    const av = new Map<string, string>()
    if (aliasIds.length) {
      const { data: al } = await admin.from('erp_vendor_aliases').select('id, vendor_id').in('id', aliasIds)
      for (const a of al ?? []) av.set(a.id as string, a.vendor_id as string)
    }
    for (const o of data ?? []) orderInfo.set(o.id as string, { order_no: o.order_no as string | null, vendor_id: av.get(o.customer_alias_id as string) ?? '' })
  }
  const nameNeeded = Array.from(new Set(Array.from(orderInfo.values()).map(o => o.vendor_id).filter(id => id && !childName.has(id))))
  if (nameNeeded.length) {
    const { data } = await admin.from('vendors').select('id, name').in('id', nameNeeded.slice(0, 150))
    for (const v of data ?? []) childName.set(v.id as string, v.name as string)
  }
  for (const l of allLinks) {
    const o = orderInfo.get(l.order_id)
    if (!o) continue
    ;(out.invoice_links[l.tax_invoice_id] ??= []).push({
      order_no: o.order_no, vendor_id: o.vendor_id, vendor_name: childName.get(o.vendor_id) ?? '', amount: l.amount,
    })
  }
  return out
}
