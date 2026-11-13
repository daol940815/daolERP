import type { SupabaseClient } from '@supabase/supabase-js'
import { cardNumberKey } from '@/lib/card-number'

// 카드 결제(card_sales 승인 1건) → ERP 주문 배분 (2026-11-13 승인 시안, 자동 매칭 없음)
// 저장은 기존 erp_payment_matches(source_type 'card'). 이 매칭은 ERP 미수(수금) 기준이고 카드사 정산 입금은 통장에서 따로 확정한다.
// 후보 = 카드의 매출처 주문 중 미수 남은 것(v_erp_order_receivable), 정렬 = 금액 일치 → 시점(결제일 −7 ~ +60일) → 최근.
// 전체 주문 검색(q)으로 다른 매출처 주문을 고르면 저장 시 그 주문의 매출처를 카드에 연결하고 카드번호를 학습한다(주문 측과 같은 규칙).

type Admin = SupabaseClient

export interface CardOrderCandidate {
  id: string; order_no: string; order_date: string; vendor_id: string | null; customer_name: string; staff_name: string | null
  net_amount: number; remaining: number
  lag: number; reason: string; score: number; in_window: boolean
}
export interface CardOrderMatch { id: string; order_id: string; order_no: string; order_date: string | null; customer_name: string; amount: number; paid_date: string }
export interface CardOrderState {
  sale: { id: string; tx_date: string; tx_time: string | null; card_number: string | null; acquirer: string | null; approval_number: string
    amount: number; cancel_amount: number; net: number; allocated: number; remaining: number; vendor_id: string | null; vendor_name: string | null
    over_allocated: boolean }
  current: CardOrderMatch[]
  candidates: CardOrderCandidate[]
}

const dayDiff = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)
const WINDOW_BEFORE = 7, WINDOW_AFTER = 60

type ViewRow = { order_id: string; order_no: string; order_date: string; vendor_id: string | null; staff_name: string | null; bank_name: string | null; branch_name: string | null; net_sales: number | null; matched_all: number | null; collect_status: string | null }

async function vendorNames(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await admin.from('vendors').select('id, name').in('id', uniq.slice(i, i + 100))
    for (const v of data ?? []) m.set(v.id as string, v.name as string)
  }
  return m
}

export async function loadCardOrderState(admin: Admin, saleId: string, q?: string | null): Promise<CardOrderState | { error: string }> {
  const { data: s } = await admin.from('card_sales')
    .select('id, tx_date, tx_time, card_number, acquirer, approval_number, amount, transaction_type, vendor_id')
    .eq('id', saleId).single()
  if (!s) return { error: '카드 결제를 찾을 수 없습니다.' }
  if (s.transaction_type !== 'approval') return { error: '승인 건만 주문에 배분할 수 있습니다.' }

  // 순액 = 승인 − 같은 승인번호의 취소 합
  const { data: cancels } = await admin.from('card_sales').select('amount').eq('transaction_type', 'cancel').eq('approval_number', s.approval_number)
  const cancelAmt = (cancels ?? []).reduce((a, c) => a + Math.abs((c.amount as number) || 0), 0)
  const net = Math.max(0, ((s.amount as number) || 0) - cancelAmt)

  // 현재 배분
  const { data: ms } = await admin.from('erp_payment_matches').select('id, order_id, amount, paid_date').eq('source_type', 'card').eq('source_id', saleId)
  const matches = ms ?? []
  const allocated = matches.reduce((a, m) => a + ((m.amount as number) || 0), 0)
  const orderIds = matches.map(m => m.order_id as string)
  const orderInfo = new Map<string, ViewRow>()
  if (orderIds.length) {
    const { data } = await admin.from('v_erp_order_receivable')
      .select('order_id, order_no, order_date, vendor_id, staff_name, bank_name, branch_name, net_sales, matched_all, collect_status').in('order_id', orderIds)
    for (const r of (data ?? []) as ViewRow[]) orderInfo.set(r.order_id, r)
  }

  // 후보: 카드 매출처 주문(미수 남은 것) 또는 전체 검색(q: 주문번호·업체)
  let rows: ViewRow[] = []
  if (q && q.trim().length >= 2) {
    const term = q.trim()
    const { data } = await admin.from('v_erp_order_receivable')
      .select('order_id, order_no, order_date, vendor_id, staff_name, bank_name, branch_name, net_sales, matched_all, collect_status')
      .or(`order_no.ilike.%${term}%,bank_name.ilike.%${term}%,branch_name.ilike.%${term}%`)
      .order('order_date', { ascending: false }).limit(40)
    rows = (data ?? []) as ViewRow[]
  } else if (s.vendor_id) {
    const { data } = await admin.from('v_erp_order_receivable')
      .select('order_id, order_no, order_date, vendor_id, staff_name, bank_name, branch_name, net_sales, matched_all, collect_status')
      .eq('vendor_id', s.vendor_id).order('order_date', { ascending: false }).limit(300)
    rows = (data ?? []) as ViewRow[]
  }
  const vn = await vendorNames(admin, [s.vendor_id as string, ...rows.map(r => r.vendor_id as string), ...Array.from(orderInfo.values()).map(r => r.vendor_id as string)])
  const remainingOfSale = net - allocated
  const currentByOrder = new Map(matches.map(m => [m.order_id as string, (m.amount as number) || 0]))

  const candidates: CardOrderCandidate[] = rows.map(r => {
    const netSales = r.net_sales ?? 0
    // 이 결제가 이미 배분한 몫은 '남은 미수'에 다시 더해 보여 준다(수정 시 그 몫을 다시 쓸 수 있게)
    const remaining = Math.max(0, netSales - (r.matched_all ?? 0)) + (currentByOrder.get(r.order_id) ?? 0)
    const lag = dayDiff(s.tx_date as string, r.order_date)
    const inWindow = lag >= -WINDOW_AFTER && lag <= WINDOW_BEFORE ? true : (lag >= -WINDOW_BEFORE && lag <= WINDOW_AFTER)
    let score = 0; const why: string[] = []
    if (remaining === remainingOfSale && remaining > 0) { score += 50; why.push('금액 일치') }
    else if (remaining === net && net > 0) { score += 45; why.push('결제 순액과 일치') }
    if (lag >= -WINDOW_BEFORE && lag <= WINDOW_AFTER) { score += 20 - Math.min(19, Math.abs(lag) / 4); why.push(lag === 0 ? '같은 날' : lag > 0 ? `${lag}일 전 주문` : `${-lag}일 뒤 주문`) }
    else why.push(lag > 0 ? `${lag}일 전 주문 (범위 밖)` : `${-lag}일 뒤 주문 (범위 밖)`)
    if (s.vendor_id && r.vendor_id === s.vendor_id) score += 10
    if (currentByOrder.has(r.order_id)) why.push('현재 배분됨')
    if (remaining <= 0) why.push('수금 완료 — 대상 아님')
    return {
      id: r.order_id, order_no: r.order_no, order_date: r.order_date, vendor_id: r.vendor_id,
      customer_name: [r.bank_name, r.branch_name].filter(Boolean).join(' ') || (r.vendor_id ? vn.get(r.vendor_id) ?? '' : ''),
      staff_name: r.staff_name, net_amount: netSales, remaining, lag, reason: why.join(' · '), score, in_window: inWindow,
    }
  })
  candidates.sort((a, b) => (b.remaining > 0 ? 1 : 0) - (a.remaining > 0 ? 1 : 0) || b.score - a.score || b.order_date.localeCompare(a.order_date))

  // 합산 가능 표시: 두세 건의 남은 미수 합이 결제 잔액과 같으면 각 행 근거에 덧붙인다(자동 선택 없음)
  const open = candidates.filter(c => c.remaining > 0 && c.remaining < remainingOfSale).slice(0, 12)
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
    if (open[i].remaining + open[j].remaining === remainingOfSale) { open[i].reason += ` · #${open[j].order_no}와 합 일치 (합산 가능)`; open[j].reason += ` · #${open[i].order_no}와 합 일치 (합산 가능)` }
  }

  return {
    sale: {
      id: s.id as string, tx_date: s.tx_date as string, tx_time: s.tx_time as string | null, card_number: s.card_number as string | null,
      acquirer: s.acquirer as string | null, approval_number: s.approval_number as string,
      amount: (s.amount as number) || 0, cancel_amount: cancelAmt, net, allocated, remaining: remainingOfSale,
      vendor_id: s.vendor_id as string | null, vendor_name: s.vendor_id ? vn.get(s.vendor_id as string) ?? null : null,
      over_allocated: allocated > net,
    },
    current: matches.map(m => {
      const o = orderInfo.get(m.order_id as string)
      return { id: m.id as string, order_id: m.order_id as string, order_no: o?.order_no ?? '(삭제된 주문)', order_date: o?.order_date ?? null,
        customer_name: o ? ([o.bank_name, o.branch_name].filter(Boolean).join(' ') || (o.vendor_id ? vn.get(o.vendor_id) ?? '' : '')) : '',
        amount: (m.amount as number) || 0, paid_date: m.paid_date as string }
    }),
    candidates,
  }
}

// 배분 저장(교체): 이 결제의 기존 card 매칭을 지우고 새 배분을 넣는다. 합 ≤ 순액, 각 ≤ 주문 남은 미수.
export async function saveCardOrderMatch(
  admin: Admin, saleId: string, allocations: { order_id: string; amount: number }[],
): Promise<{ ok: true; inserted: number; linked_vendor: boolean; registered_card: boolean } | { ok: false; error: string }> {
  const state = await loadCardOrderState(admin, saleId)
  if ('error' in state) return { ok: false, error: state.error }
  const rows = allocations.map(a => ({ order_id: a.order_id, amount: Math.round(Number(a.amount)) })).filter(a => a.order_id && a.amount > 0)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  if (total > state.sale.net) return { ok: false, error: `배분 합(${total.toLocaleString('ko-KR')}원)이 결제 순액(${state.sale.net.toLocaleString('ko-KR')}원)을 넘습니다.` }
  // 주문 남은 미수 검증 (이 결제의 기존 배분은 되돌린 상태로 본다 = candidates.remaining 규칙)
  const byId = new Map(state.candidates.map(c => [c.id, c]))
  const missing = rows.filter(r => !byId.has(r.order_id)).map(r => r.order_id)
  if (missing.length) {
    const { data } = await admin.from('v_erp_order_receivable').select('order_id, net_sales, matched_all, vendor_id').in('order_id', missing)
    const cur = new Map(state.current.map(m => [m.order_id, m.amount]))
    for (const r of (data ?? []) as { order_id: string; net_sales: number | null; matched_all: number | null; vendor_id: string | null }[]) {
      byId.set(r.order_id, { id: r.order_id, order_no: '', order_date: '', vendor_id: r.vendor_id, customer_name: '', staff_name: null, net_amount: r.net_sales ?? 0,
        remaining: Math.max(0, (r.net_sales ?? 0) - (r.matched_all ?? 0)) + (cur.get(r.order_id) ?? 0), lag: 0, reason: '', score: 0, in_window: true })
    }
  }
  for (const r of rows) {
    const c = byId.get(r.order_id)
    if (!c) return { ok: false, error: '주문을 찾을 수 없습니다.' }
    if (r.amount > c.remaining) return { ok: false, error: `주문 #${c.order_no || r.order_id.slice(0, 8)}의 남은 미수(${c.remaining.toLocaleString('ko-KR')}원)보다 큰 금액은 배분할 수 없습니다.` }
  }

  const { error: de } = await admin.from('erp_payment_matches').delete().eq('source_type', 'card').eq('source_id', saleId)
  if (de) return { ok: false, error: de.message }
  if (rows.length) {
    const { error: ie } = await admin.from('erp_payment_matches').insert(rows.map(r => ({
      order_id: r.order_id, source_type: 'card', source_id: saleId, amount: r.amount, paid_date: state.sale.tx_date, matched_by: 'manual',
    })))
    if (ie) return { ok: false, error: ie.message }
  }

  // 거래처 없는 카드 → 첫 배분 주문의 매출처로 연결 + 카드번호 학습 (주문 측 배분과 같은 규칙)
  let linked = false, registered = false
  if (rows.length && !state.sale.vendor_id) {
    const vid = byId.get(rows[0].order_id)?.vendor_id ?? null
    if (vid) {
      const { error } = await admin.from('card_sales').update({ vendor_id: vid }).eq('approval_number', state.sale.approval_number).is('vendor_id', null)
      linked = !error
      const key = cardNumberKey(state.sale.card_number)
      if (key) {
        const { data: v } = await admin.from('vendors').select('card_numbers').eq('id', vid).maybeSingle()
        const list = ((v?.card_numbers as string[] | null) ?? [])
        if (!list.some(c => cardNumberKey(c) === key)) {
          const { error: ue } = await admin.from('vendors').update({ card_numbers: [...list, state.sale.card_number] }).eq('id', vid)
          registered = !ue
        }
      }
    }
  }
  return { ok: true, inserted: rows.length, linked_vendor: linked, registered_card: registered }
}
