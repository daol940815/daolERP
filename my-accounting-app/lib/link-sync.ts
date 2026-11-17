import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUser } from './user-role'
import { loadReceivableMap } from './orders-portal-list'
import { syncRecordsForOrders } from './payment-records'

// ── 주문 · 계산서 · 통장 입금 연결 동기화 (1302, 2026-11-17 사용자 승인 — 시안 docs/mockups/연결동기화_시안.html) ──
// 연결은 세 갈래로 저장된다: 주문↔입금(erp_payment_matches) · 주문↔계산서(erp_order_invoices) · 계산서↔통장(tax_invoice_payments).
// 주문과 계산서가 연결돼 있으면, 계산서에 붙은 입금을 그 주문의 수금으로도 넘긴다(1단계: 계산서 → 주문).
//   · 넘어온 수금 = erp_payment_matches.from_invoice_id 가 채워진 행. 사람이 붙인 행(NULL)은 만들지도 지우지도 않는다.
//   · 원천은 회계가 직접 붙인 계산서 입금뿐(from_order_sync = false) — 자동 행을 다시 원천으로 쓰지 않아 되돌이가 없다.
//   · 넘치지 않게: 연결 금액 · 주문 순매출 · 입금 잔액 중 작은 값까지. 주문 · 입금 여러 건이면 날짜 순으로 채운다.
//   · 항상 "지금 있어야 할 모습"을 다시 계산해 차이만 고친다 — 입금을 붙일 때 · 풀 때 · 주문↔계산서를 연결 · 해제할 때 같은 함수를 부른다.
// 대상: 매출 계산서(양수) · 통장 입금. 카드 · 선결제 · 매입 계산서는 대상이 아니다.
// 1302 미적용이면 아무 일도 하지 않는다(기존 동작 그대로).

const chunk = <T,>(a: T[], n = 150) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

let ready: boolean | null = null
export async function linkSyncReady(admin: SupabaseClient): Promise<boolean> {
  if (ready) return true
  const { error } = await admin.from('erp_payment_matches').select('from_invoice_id').limit(1)
  ready = !error
  return ready
}

export const FROM_INVOICE_MEMO = '계산서 입금에서 넘어옴'
export const FROM_INVOICE_BLOCK = '계산서에 붙은 입금에서 자동으로 넘어온 수금입니다. 회계 › 계산서 내역에서 그 입금 연결을 풀거나, 주문 상세 › 결제 내역에서 계산서 연결을 해제하면 함께 풀립니다.'

export interface SyncResult { created: number; removed: number; amount: number; orderIds: string[] }

export async function syncOrderMatchesFromInvoices(admin: SupabaseClient, invoiceIds: string[], origin: string): Promise<SyncResult> {
  const out: SyncResult = { created: 0, removed: 0, amount: 0, orderIds: [] }
  try {
    const ids = Array.from(new Set(invoiceIds.filter(Boolean)))
    if (!ids.length || !(await linkSyncReady(admin))) return out

    // 매출 계산서(양수)만
    const salesIds: string[] = []
    for (const ch of chunk(ids)) {
      const { data } = await admin.from('tax_invoices').select('id, direction, total_amount').in('id', ch)
      for (const t of data ?? []) if (t.direction === 'sales' && Number(t.total_amount ?? 0) > 0) salesIds.push(t.id as string)
    }

    // 지금 있는 넘어온 수금 (지워진 계산서 · 매입 계산서로 바뀐 경우까지 정리하려고 요청 id 전부로 읽는다)
    type Derived = { id: string; order_id: string; source_id: string; amount: number; from_invoice_id: string }
    const existing: Derived[] = []
    for (const ch of chunk(ids)) {
      const { data, error } = await admin.from('erp_payment_matches')
        .select('id, order_id, source_id, amount, from_invoice_id').in('from_invoice_id', ch)
      if (error) return out
      existing.push(...((data ?? []) as Derived[]))
    }

    // 주문↔계산서 연결, 계산서에 직접 붙인 입금
    type Link = { order_id: string; tax_invoice_id: string; amount: number }
    type Pay = { tax_invoice_id: string; amount: number; transaction: { id: string; tx_date: string; amount_in: number | null } | null }
    const links: Link[] = []
    const pays: Pay[] = []
    for (const ch of chunk(salesIds)) {
      const [l, p] = await Promise.all([
        admin.from('erp_order_invoices').select('order_id, tax_invoice_id, amount').in('tax_invoice_id', ch),
        admin.from('tax_invoice_payments').select('tax_invoice_id, amount, transaction:transactions(id, tx_date, amount_in)')
          .in('tax_invoice_id', ch).eq('from_order_sync', false).gt('amount', 0),
      ])
      if (l.error || p.error) return out
      links.push(...((l.data ?? []) as Link[]).map(x => ({ ...x, amount: Number(x.amount ?? 0) })))
      pays.push(...((p.data ?? []) as unknown as Pay[]).map(x => ({ ...x, amount: Number(x.amount ?? 0) })))
    }

    // 주문 정보 (취소 주문 제외, 날짜 순 배분용) · 순매출
    const orderIds = Array.from(new Set(links.map(l => l.order_id)))
    const orderDate = new Map<string, string>()
    for (const ch of chunk(orderIds)) {
      const { data } = await admin.from('erp_orders').select('id, order_date, canceled_at').in('id', ch)
      for (const o of data ?? []) if (!o.canceled_at) orderDate.set(o.id as string, String(o.order_date))
    }
    const recv = await loadReceivableMap(admin, Array.from(orderDate.keys()))
    if (!recv && orderDate.size) return out

    // 상한 계산용: 이번에 다시 계산하는 넘어온 수금을 뺀 나머지 수금(직접 붙인 것 · 다른 계산서에서 넘어온 것)
    const idSet = new Set(ids)
    const orderOther = new Map<string, number>()
    const txOther = new Map<string, number>()
    const txIds = Array.from(new Set(pays.map(p => p.transaction?.id).filter((x): x is string => !!x)))
    for (const ch of chunk(Array.from(orderDate.keys()))) {
      const { data } = await admin.from('erp_payment_matches').select('order_id, amount, from_invoice_id').in('order_id', ch)
      for (const m of data ?? []) {
        if (m.from_invoice_id && idSet.has(m.from_invoice_id as string)) continue
        orderOther.set(m.order_id as string, (orderOther.get(m.order_id as string) ?? 0) + Number(m.amount ?? 0))
      }
    }
    for (const ch of chunk(txIds)) {
      const { data } = await admin.from('erp_payment_matches').select('source_id, amount, from_invoice_id').eq('source_type', 'bank').in('source_id', ch)
      for (const m of data ?? []) {
        if (m.from_invoice_id && idSet.has(m.from_invoice_id as string)) continue
        txOther.set(m.source_id as string, (txOther.get(m.source_id as string) ?? 0) + Number(m.amount ?? 0))
      }
    }
    const orderCap = new Map<string, number>()
    for (const id of Array.from(orderDate.keys())) orderCap.set(id, Math.max(0, (recv?.get(id)?.net_sales ?? 0) - (orderOther.get(id) ?? 0)))
    const txCap = new Map<string, number>()
    for (const p of pays) if (p.transaction) txCap.set(p.transaction.id, Math.max(0, Number(p.transaction.amount_in ?? 0) - (txOther.get(p.transaction.id) ?? 0)))

    // 있어야 할 모습: 계산서마다 입금(날짜 순)을 연결된 주문(주문일 순)에 채운다
    type Want = { invoice: string; order: string; tx: string; date: string; amount: number }
    const want = new Map<string, Want>()
    for (const inv of salesIds) {
      const ls = links.filter(l => l.tax_invoice_id === inv && orderDate.has(l.order_id))
        .sort((a, b) => orderDate.get(a.order_id)!.localeCompare(orderDate.get(b.order_id)!))
        .map(l => ({ ...l }))
      const ps = pays.filter(p => p.tax_invoice_id === inv && p.transaction && Number(p.transaction.amount_in ?? 0) > 0)
        .sort((a, b) => a.transaction!.tx_date.localeCompare(b.transaction!.tx_date))
      for (const p of ps) {
        let rest = p.amount
        const tx = p.transaction!
        for (const l of ls) {
          if (rest <= 0) break
          const amt = Math.min(rest, l.amount, orderCap.get(l.order_id) ?? 0, txCap.get(tx.id) ?? 0)
          if (amt <= 0) continue
          const k = `${inv}|${l.order_id}|${tx.id}`
          const cur = want.get(k) ?? { invoice: inv, order: l.order_id, tx: tx.id, date: String(tx.tx_date).slice(0, 10), amount: 0 }
          cur.amount += amt; want.set(k, cur)
          rest -= amt; l.amount -= amt
          orderCap.set(l.order_id, (orderCap.get(l.order_id) ?? 0) - amt)
          txCap.set(tx.id, (txCap.get(tx.id) ?? 0) - amt)
        }
      }
    }

    // 차이만 고친다
    const touched = new Set<string>()
    const have = new Map<string, Derived[]>()
    for (const d of existing) { const k = `${d.from_invoice_id}|${d.order_id}|${d.source_id}`; have.set(k, [...(have.get(k) ?? []), d]) }
    for (const [k, rows] of Array.from(have)) {
      const w = want.get(k)
      const [first, ...dups] = rows
      for (const d of dups) { await admin.from('erp_payment_matches').delete().eq('id', d.id); out.removed++; touched.add(d.order_id) }
      if (!w) { await admin.from('erp_payment_matches').delete().eq('id', first.id); out.removed++; touched.add(first.order_id); continue }
      if (Number(first.amount) !== w.amount) { await admin.from('erp_payment_matches').update({ amount: w.amount }).eq('id', first.id); touched.add(first.order_id) }
      want.delete(k)
    }
    const inserts = Array.from(want.values()).map(w => ({
      order_id: w.order, source_type: 'bank', source_id: w.tx, amount: w.amount, paid_date: w.date,
      matched_by: 'auto', memo: FROM_INVOICE_MEMO, from_invoice_id: w.invoice,
    }))
    if (inserts.length) {
      const { error } = await admin.from('erp_payment_matches').insert(inserts)
      if (!error) { out.created = inserts.length; out.amount = inserts.reduce((s, r) => s + r.amount, 0); for (const r of inserts) touched.add(r.order_id) }
    }

    out.orderIds = Array.from(touched)
    // 결제 기록(1300)과 맞춘다 — 넘어온 수금으로 기록이 채워지면 매칭 완료, 빠지면 매칭 대기로
    if (out.orderIds.length) {
      const me = await getCurrentUser().catch(() => null)
      await syncRecordsForOrders(admin, out.orderIds, { employeeId: me?.employeeId ?? null, employeeName: me?.employeeName ?? null }, origin)
    }
  } catch { /* 동기화 실패는 원래 조작(입금 연결 · 계산서 연결)에 영향을 주지 않는다 */ }
  return out
}
