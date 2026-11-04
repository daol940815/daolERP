import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { netSalesOf } from '@/lib/receivable'
import { cardNumberKey } from '@/lib/card-number'

// ── 주문 쪽 수금 매칭 (2026-11-04) ───────────────────────────────────────
// 입금 매칭 화면(/erp-matching)은 결제 1건 → 주문 여러 건으로 출발한다. 여기는 반대로
// 주문 1건에서 출발해 "이 주문의 거래처로 들어온 미배분 결제(은행 입금·카드결제)"를 고르고 금액을 붙인다.
//   · scope 'vendor': 주문 거래처의 결제만 / 'all': 거래처 무관(거래처 없는 카드결제 포함) — 날짜·금액·카드 끝4·입금자로 검색
//   · 카드결제는 승인 − 취소 순액. 전액 취소는 후보에서 제외
//   · 저장: erp_payment_matches(source_type bank|card) — 결제 잔액·주문 잔액을 넘지 않게
//   · 거래처 없는 카드결제를 붙이면 주문 거래처로 연결(같은 승인번호의 승인·취소 행 모두), 옵션으로 카드번호를 거래처에 등록

export interface OrderCollectSummary {
  id: string
  order_no: string | null
  order_date: string
  customer_name: string
  vendor_id: string | null
  vendor_name: string | null
  collect_status: string | null
  net_amount: number
  allocated: number
  remaining: number
  matches: { id: string; source_type: string; source_id: string; amount: number; paid_date: string; label: string }[]
}

export interface CollectCandidate {
  source_type: 'bank' | 'card'
  id: string
  tx_date: string
  tx_time: string | null
  label: string            // 통장: 입금자·적요 / 카드: 카드번호 · 매입사
  card_number: string | null
  vendor_id: string | null
  vendor_name: string | null
  amount: number           // 입금액 / 카드 순액
  allocated: number
  remaining: number
}

export interface CandidateQuery {
  scope: 'vendor' | 'all'
  from?: string | null
  to?: string | null
  amount?: number | null
  card4?: string | null
  q?: string | null
  onlyRemaining?: boolean
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}

async function allocatedBySource(admin: SupabaseClient, keys: { type: string; id: string }[]) {
  const out = new Map<string, number>()
  const ids = Array.from(new Set(keys.map(k => k.id)))
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from('erp_payment_matches').select('source_type, source_id, amount').in('source_id', ids.slice(i, i + 150))
    if (error) throw new Error(error.message)
    for (const m of data ?? []) {
      const k = `${m.source_type}:${m.source_id}`
      out.set(k, (out.get(k) ?? 0) + (m.amount as number))
    }
  }
  return out
}

export async function loadOrderCollectSummary(admin: SupabaseClient, orderId: string): Promise<OrderCollectSummary | { error: string }> {
  const { data: o, error } = await admin
    .from('erp_orders')
    .select('id, order_no, order_date, bank_name, branch_name, customer_alias_id, vendor_id, collect_status')
    .eq('id', orderId).maybeSingle()
  if (error) return { error: error.message }
  if (!o) return { error: '주문을 찾을 수 없습니다.' }
  // 거래처: 별칭(customer_alias_id → vendor_id) 우선, direct 주문은 erp_orders.vendor_id
  let vendorId: string | null = null
  if (o.customer_alias_id) {
    const { data: a } = await admin.from('erp_vendor_aliases').select('vendor_id').eq('id', o.customer_alias_id).maybeSingle()
    vendorId = (a?.vendor_id as string | null) ?? null
  }
  if (!vendorId && o.vendor_id) vendorId = o.vendor_id as string
  let vendorName: string | null = null
  if (vendorId) {
    const { data: v } = await admin.from('vendors').select('name').eq('id', vendorId).maybeSingle()
    vendorName = (v?.name as string | null) ?? null
  }

  const { data: items, error: ie } = await admin.from('erp_order_items')
    .select('line_total, is_canceled, is_vip, is_prepayment').eq('order_id', orderId)
  if (ie) return { error: ie.message }
  const net = netSalesOf(items ?? [])

  const { data: ms, error: me } = await admin.from('erp_payment_matches')
    .select('id, source_type, source_id, amount, paid_date').eq('order_id', orderId).order('paid_date')
  if (me) return { error: me.message }
  const matches = (ms ?? []) as { id: string; source_type: string; source_id: string; amount: number; paid_date: string }[]
  // 매칭된 결제의 표시용 라벨
  const bankIds = matches.filter(m => m.source_type === 'bank').map(m => m.source_id)
  const cardIds = matches.filter(m => m.source_type === 'card').map(m => m.source_id)
  const label = new Map<string, string>()
  if (bankIds.length) {
    const { data } = await admin.from('transactions').select('id, counterparty_name, description').in('id', bankIds.slice(0, 200))
    for (const t of data ?? []) label.set(`bank:${t.id}`, `계좌 ${t.counterparty_name || t.description || ''}`.trim())
  }
  if (cardIds.length) {
    const { data } = await admin.from('card_sales').select('id, card_number, acquirer').in('id', cardIds.slice(0, 200))
    for (const c of data ?? []) label.set(`card:${c.id}`, `카드 ${c.card_number ?? ''} ${c.acquirer ?? ''}`.trim())
  }
  const allocated = matches.reduce((s, m) => s + m.amount, 0)
  return {
    id: o.id as string, order_no: o.order_no as string | null, order_date: o.order_date as string,
    customer_name: [o.bank_name, o.branch_name].filter(Boolean).join(' '),
    vendor_id: vendorId, vendor_name: vendorName, collect_status: o.collect_status as string | null,
    net_amount: net, allocated, remaining: Math.max(0, net - allocated),
    matches: matches.map(m => ({ ...m, label: label.get(`${m.source_type}:${m.source_id}`) ?? m.source_type })),
  }
}

export async function loadCollectCandidates(
  admin: SupabaseClient,
  order: OrderCollectSummary,
  qy: CandidateQuery,
): Promise<{ data: CollectCandidate[] } | { error: string }> {
  const scope = qy.scope === 'all' ? 'all' : 'vendor'
  if (scope === 'vendor' && !order.vendor_id) return { data: [] }
  // 전체 검색 기본 기간: 주문일 −30일 ~ 오늘 (선입금 관행 고려)
  const from = qy.from || (scope === 'all' ? addDays(order.order_date, -30) : null)
  const to = qy.to || null
  const q = (qy.q ?? '').trim()
  const card4 = (qy.card4 ?? '').replace(/\D/g, '').slice(-4)
  const amount = qy.amount && qy.amount > 0 ? Math.round(qy.amount) : null

  // 통장 입금
  type Tx = { id: string; tx_date: string; tx_time: string | null; counterparty_name: string | null; description: string | null; vendor_id: string | null; amount_in: number | null; vendors: { name: string } | { name: string }[] | null }
  const txRes = await fetchAllRows<Tx>((f, t) => {
    let s = admin.from('transactions')
      .select('id, tx_date, tx_time, counterparty_name, description, vendor_id, amount_in, vendors(name)')
      .gt('amount_in', 0).is('transfer_pair_id', null).order('tx_date', { ascending: false })
    if (scope === 'vendor') s = s.eq('vendor_id', order.vendor_id!)
    if (from) s = s.gte('tx_date', from)
    if (to) s = s.lte('tx_date', to)
    if (amount) s = s.eq('amount_in', amount)
    if (q && scope === 'all') s = s.or(`counterparty_name.ilike.%${q}%,description.ilike.%${q}%`)
    return s.range(f, t)
  })
  if ('error' in txRes) return { error: txRes.error }
  const txRows = card4 && scope === 'all' ? [] : txRes.data.slice(0, 300)   // 카드 끝4자리 검색은 카드결제만

  // 카드결제 (승인 행) + 같은 승인번호의 취소 행으로 순액
  type Cs = { id: string; tx_date: string; tx_time: string | null; approval_number: string; card_number: string | null; acquirer: string | null; amount: number | null; transaction_type: string; vendor_id: string | null; vendors: { name: string } | { name: string }[] | null }
  const csRes = await fetchAllRows<Cs>((f, t) => {
    let s = admin.from('card_sales')
      .select('id, tx_date, tx_time, approval_number, card_number, acquirer, amount, transaction_type, vendor_id, vendors(name)')
      .eq('transaction_type', 'approval').order('tx_date', { ascending: false })
    if (scope === 'vendor') s = s.eq('vendor_id', order.vendor_id!)
    if (from) s = s.gte('tx_date', from)
    if (to) s = s.lte('tx_date', to)
    if (amount) s = s.eq('amount', amount)
    if (card4) s = s.ilike('card_number', `%${card4}`)
    if (q && scope === 'all') s = s.or(`card_number.ilike.%${q}%,acquirer.ilike.%${q}%`)
    return s.range(f, t)
  })
  if ('error' in csRes) return { error: csRes.error }
  const approvals = csRes.data.slice(0, 300)
  const cancelByApproval = new Map<string, number>()
  const apprNos = approvals.map(a => a.approval_number)
  for (let i = 0; i < apprNos.length; i += 150) {
    const { data, error } = await admin.from('card_sales').select('approval_number, amount')
      .eq('transaction_type', 'cancel').in('approval_number', apprNos.slice(i, i + 150))
    if (error) return { error: error.message }
    for (const c of data ?? []) cancelByApproval.set(c.approval_number as string, (cancelByApproval.get(c.approval_number as string) ?? 0) + Math.abs((c.amount as number) || 0))
  }

  let alloc: Map<string, number>
  try {
    alloc = await allocatedBySource(admin, [
      ...txRows.map(t => ({ type: 'bank', id: t.id })),
      ...approvals.map(a => ({ type: 'card', id: a.id })),
    ])
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }

  const vName = (v: Tx['vendors']) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null
  const out: CollectCandidate[] = []
  for (const t of txRows) {
    const amt = t.amount_in ?? 0
    const used = alloc.get(`bank:${t.id}`) ?? 0
    out.push({
      source_type: 'bank', id: t.id, tx_date: t.tx_date, tx_time: t.tx_time,
      label: (t.counterparty_name || t.description || '').trim(), card_number: null,
      vendor_id: t.vendor_id, vendor_name: vName(t.vendors), amount: amt, allocated: used, remaining: amt - used,
    })
  }
  for (const a of approvals) {
    const net = Math.abs(a.amount ?? 0) - (cancelByApproval.get(a.approval_number) ?? 0)
    if (net <= 0) continue
    const used = alloc.get(`card:${a.id}`) ?? 0
    out.push({
      source_type: 'card', id: a.id, tx_date: a.tx_date, tx_time: a.tx_time,
      label: `${a.card_number ?? ''} · ${a.acquirer ?? ''}`.trim(), card_number: a.card_number,
      vendor_id: a.vendor_id, vendor_name: vName(a.vendors), amount: net, allocated: used, remaining: net - used,
    })
  }
  const filtered = qy.onlyRemaining === false ? out : out.filter(c => c.remaining > 0)
  // 주문일에 가까운 순, 같은 날이면 금액이 주문 잔액과 같은 것 먼저
  const od = new Date(order.order_date).getTime()
  filtered.sort((x, y) => {
    const ex = x.remaining === order.remaining ? 0 : 1, ey = y.remaining === order.remaining ? 0 : 1
    if (ex !== ey) return ex - ey
    return Math.abs(new Date(x.tx_date).getTime() - od) - Math.abs(new Date(y.tx_date).getTime() - od)
  })
  return { data: filtered.slice(0, 200) }
}

export interface OrderAllocation { source_type: 'bank' | 'card'; source_id: string; amount: number }

// 주문에 결제를 배분한다. 결제·주문 잔액 검증 후 erp_payment_matches에 insert.
// 거래처 없는 카드결제는 주문 거래처로 연결하고, registerCard면 카드번호를 거래처에 등록한다.
export async function allocateToOrder(
  admin: SupabaseClient,
  orderId: string,
  allocations: OrderAllocation[],
  opts: { registerCard?: boolean; memo?: string | null } = {},
): Promise<{ inserted: number; linked_vendor: number; registered_cards: number } | { error: string }> {
  const order = await loadOrderCollectSummary(admin, orderId)
  if ('error' in order) return order
  const rows = allocations.map(a => ({ ...a, amount: Math.round(Number(a.amount)) })).filter(a => a.amount > 0 && a.source_id)
  if (!rows.length) return { error: '배분할 결제와 금액을 입력하세요.' }
  const total = rows.reduce((s, a) => s + a.amount, 0)
  if (total > order.remaining) return { error: `배분 합계(${total.toLocaleString('ko-KR')}원)가 주문 미수(${order.remaining.toLocaleString('ko-KR')}원)를 초과합니다.` }

  // 결제별 잔액 검증 + 결제일
  let alloc: Map<string, number>
  try { alloc = await allocatedBySource(admin, rows.map(r => ({ type: r.source_type, id: r.source_id }))) }
  catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  const paidDate = new Map<string, string>()
  const cardMeta = new Map<string, { approval_number: string; card_number: string | null; vendor_id: string | null }>()
  const bankIds = rows.filter(r => r.source_type === 'bank').map(r => r.source_id)
  const cardIds = rows.filter(r => r.source_type === 'card').map(r => r.source_id)
  const remainingOf = new Map<string, number>()
  if (bankIds.length) {
    const { data, error } = await admin.from('transactions').select('id, tx_date, amount_in').in('id', bankIds)
    if (error) return { error: error.message }
    for (const t of data ?? []) { paidDate.set(`bank:${t.id}`, String(t.tx_date).slice(0, 10)); remainingOf.set(`bank:${t.id}`, ((t.amount_in as number) ?? 0) - (alloc.get(`bank:${t.id}`) ?? 0)) }
  }
  if (cardIds.length) {
    const { data, error } = await admin.from('card_sales').select('id, tx_date, amount, approval_number, card_number, vendor_id').in('id', cardIds)
    if (error) return { error: error.message }
    const nos = (data ?? []).map(c => c.approval_number as string)
    const cancel = new Map<string, number>()
    if (nos.length) {
      const { data: cs } = await admin.from('card_sales').select('approval_number, amount').eq('transaction_type', 'cancel').in('approval_number', nos)
      for (const c of cs ?? []) cancel.set(c.approval_number as string, (cancel.get(c.approval_number as string) ?? 0) + Math.abs((c.amount as number) || 0))
    }
    for (const c of data ?? []) {
      paidDate.set(`card:${c.id}`, String(c.tx_date).slice(0, 10))
      const net = Math.abs((c.amount as number) ?? 0) - (cancel.get(c.approval_number as string) ?? 0)
      remainingOf.set(`card:${c.id}`, net - (alloc.get(`card:${c.id}`) ?? 0))
      cardMeta.set(c.id as string, { approval_number: c.approval_number as string, card_number: c.card_number as string | null, vendor_id: c.vendor_id as string | null })
    }
  }
  for (const r of rows) {
    const k = `${r.source_type}:${r.source_id}`
    if (!paidDate.has(k)) return { error: '결제 내역을 찾을 수 없습니다.' }
    const rem = remainingOf.get(k) ?? 0
    if (r.amount > rem) return { error: `결제 잔액(${rem.toLocaleString('ko-KR')}원)보다 큰 금액(${r.amount.toLocaleString('ko-KR')}원)은 배분할 수 없습니다.` }
  }

  const { error: ie } = await admin.from('erp_payment_matches').insert(rows.map(r => ({
    order_id: orderId, source_type: r.source_type, source_id: r.source_id, amount: r.amount,
    paid_date: paidDate.get(`${r.source_type}:${r.source_id}`), matched_by: 'manual', memo: opts.memo?.trim() || '주문 쪽 수금 매칭',
  })))
  if (ie) return { error: ie.message }

  // 거래처 없는 카드결제 → 주문 거래처로 연결 (+ 카드번호 등록)
  let linked = 0, registered = 0
  if (order.vendor_id) {
    for (const r of rows.filter(r => r.source_type === 'card')) {
      const meta = cardMeta.get(r.source_id)
      if (!meta || meta.vendor_id) continue
      const { error } = await admin.from('card_sales').update({ vendor_id: order.vendor_id }).eq('approval_number', meta.approval_number).is('vendor_id', null)
      if (!error) linked++
      if (opts.registerCard && meta.card_number) {
        const key = cardNumberKey(meta.card_number)
        const { data: v } = await admin.from('vendors').select('card_numbers').eq('id', order.vendor_id).maybeSingle()
        const list = ((v?.card_numbers as string[] | null) ?? [])
        if (key && !list.some(c => cardNumberKey(c) === key)) {
          const { error: ue } = await admin.from('vendors').update({ card_numbers: [...list, meta.card_number] }).eq('id', order.vendor_id)
          if (!ue) registered++
        }
      }
    }
  }
  return { inserted: rows.length, linked_vendor: linked, registered_cards: registered }
}
