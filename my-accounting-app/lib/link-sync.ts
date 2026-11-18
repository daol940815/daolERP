import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCanceledInvoices } from './payment-cancel-meta'
import { getCurrentUser } from './user-role'
import { loadReceivableMap } from './orders-portal-list'
import { syncRecordsForOrders } from './payment-records'
import { logUnmatch } from './match-log'

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

export async function syncOrderMatchesFromInvoices(admin: SupabaseClient, invoiceIds: string[], origin: string, reason?: { code: string; text: string } | null): Promise<SyncResult> {
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
    // 취소 계산서가 붙은 원 계산서(1305)는 대상에서 뺀다 — 넘어가 있던 주문 수금은 아래에서 '있어야 할 모습'에 없어 지워진다
    { const dead = (await loadCanceledInvoices(admin, salesIds)).originals; for (let i = salesIds.length - 1; i >= 0; i--) if (dead.has(salesIds[i])) salesIds.splice(i, 1) }

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
    const gone: Derived[] = []   // 풀린 넘어온 수금 — 매칭 해제 이력(1307)에 남긴다
    const have = new Map<string, Derived[]>()
    for (const d of existing) { const k = `${d.from_invoice_id}|${d.order_id}|${d.source_id}`; have.set(k, [...(have.get(k) ?? []), d]) }
    for (const [k, rows] of Array.from(have)) {
      const w = want.get(k)
      const [first, ...dups] = rows
      for (const d of dups) { await admin.from('erp_payment_matches').delete().eq('id', d.id); out.removed++; touched.add(d.order_id); gone.push(d) }
      if (!w) { await admin.from('erp_payment_matches').delete().eq('id', first.id); out.removed++; touched.add(first.order_id); gone.push(first); continue }
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

    if (gone.length) await logUnmatch(admin, gone.map(d => ({ id: d.id, order_id: d.order_id, source_type: 'bank', source_id: d.source_id, amount: d.amount })), `${origin} — 넘어온 수금 자동 해제`, reason ?? null)
    out.orderIds = Array.from(touched)
    // 결제 기록(1300)과 맞춘다 — 넘어온 수금으로 기록이 채워지면 매칭 완료, 빠지면 매칭 대기로
    if (out.orderIds.length) {
      const me = await getCurrentUser().catch(() => null)
      await syncRecordsForOrders(admin, out.orderIds, { employeeId: me?.employeeId ?? null, employeeName: me?.employeeName ?? null }, origin)
    }
  } catch { /* 동기화 실패는 원래 조작(입금 연결 · 계산서 연결)에 영향을 주지 않는다 */ }
  return out
}

// ── 2단계: 주문 → 계산서 (2026-11-17 사용자 "2단계 진행해줘") ─────────────────────────
// 주문과 계산서가 연결돼 있으면, 주문에 직접 붙인 통장 입금을 그 계산서의 입금으로도 넘긴다 → 계산서가 부분 확인 · 확인됨이 된다.
//   · 넘어온 계산서 입금 = tax_invoice_payments.from_order_sync = true. 회계가 직접 붙인 행(false)은 만들지도 지우지도 않는다.
//   · 원천은 주문에 직접 붙인 통장 수금뿐(from_invoice_id IS NULL · source_type 'bank') — 1단계로 넘어온 수금은 원천이 아니다(되돌이 없음).
//   · 같은 계산서 · 같은 입금을 회계가 이미 직접 붙여 뒀으면 그 금액만큼은 넘기지 않는다(이미 반영된 돈).
//   · 넘치지 않게: 연결 금액 · 계산서 남은 금액(합계 − 직접 붙인 입금) · 입금의 계산서 배분 잔액 중 작은 값까지.
//     주문 1건이 계산서 여러 장에 연결돼 있으면 발행일 순으로 채운다.
// 넘어온 계산서 입금은 계산서 내역에서 지울 수 없다 — 주문 쪽 수금을 풀면 함께 풀린다.
export const FROM_ORDER_BLOCK = '주문에 붙인 수금에서 자동으로 넘어온 입금입니다. 결제 확인 또는 주문 쪽에서 그 수금을 풀면 함께 풀립니다.'

export async function syncInvoicePaymentsFromOrders(admin: SupabaseClient, invoiceIdsIn: string[]): Promise<{ created: number; removed: number; invoiceIds: string[] }> {
  const out = { created: 0, removed: 0, invoiceIds: [] as string[] }
  try {
    const seed = Array.from(new Set(invoiceIdsIn.filter(Boolean)))
    if (!seed.length || !(await linkSyncReady(admin))) return out

    // 범위 넓히기: 요청 계산서 → 연결된 주문 → 그 주문들에 연결된 계산서 전부 (주문 1건이 계산서 여러 장에 걸친 경우를 함께 계산)
    type Link = { order_id: string; tax_invoice_id: string; amount: number }
    const seedLinks: Link[] = []
    for (const ch of chunk(seed)) {
      const { data, error } = await admin.from('erp_order_invoices').select('order_id, tax_invoice_id, amount').in('tax_invoice_id', ch)
      if (error) return out
      seedLinks.push(...((data ?? []) as Link[]))
    }
    const orderIds = Array.from(new Set(seedLinks.map(l => l.order_id)))
    const links: Link[] = []
    for (const ch of chunk(orderIds)) {
      const { data, error } = await admin.from('erp_order_invoices').select('order_id, tax_invoice_id, amount').in('order_id', ch)
      if (error) return out
      links.push(...((data ?? []) as Link[]).map(x => ({ ...x, amount: Number(x.amount ?? 0) })))
    }
    const scope = Array.from(new Set([...seed, ...links.map(l => l.tax_invoice_id)]))

    // 계산서(매출 · 양수만 대상), 계산서 입금(직접 · 넘어온 것)
    const inv = new Map<string, { total: number; issue_date: string }>()
    type PayRow = { id: string; tax_invoice_id: string; transaction_id: string; amount: number; from_order_sync: boolean }
    const payRows: PayRow[] = []
    for (const ch of chunk(scope)) {
      const [t, p] = await Promise.all([
        admin.from('tax_invoices').select('id, direction, total_amount, issue_date').in('id', ch),
        admin.from('tax_invoice_payments').select('id, tax_invoice_id, transaction_id, amount, from_order_sync').in('tax_invoice_id', ch),
      ])
      if (t.error || p.error) return out
      for (const x of t.data ?? []) if (x.direction === 'sales' && Number(x.total_amount ?? 0) > 0) inv.set(x.id as string, { total: Number(x.total_amount), issue_date: String(x.issue_date).slice(0, 10) })
      payRows.push(...((p.data ?? []) as PayRow[]).map(x => ({ ...x, amount: Number(x.amount ?? 0) })))
    }
    // 취소된 원 계산서(1305)로는 주문 수금을 넘기지 않는다
    for (const id of Array.from((await loadCanceledInvoices(admin, Array.from(inv.keys()))).originals)) inv.delete(id)
    const manual = payRows.filter(p => !p.from_order_sync)
    const derived = payRows.filter(p => p.from_order_sync)

    // 주문(취소 제외)과 주문에 직접 붙인 통장 수금
    const orderDate = new Map<string, string>()
    type M = { order_id: string; source_id: string; amount: number; paid_date: string }
    const matches: M[] = []
    for (const ch of chunk(orderIds)) {
      const [o, m] = await Promise.all([
        admin.from('erp_orders').select('id, order_date, canceled_at').in('id', ch),
        admin.from('erp_payment_matches').select('order_id, source_id, amount, paid_date').in('order_id', ch).eq('source_type', 'bank').is('from_invoice_id', null),
      ])
      if (o.error || m.error) return out
      for (const x of o.data ?? []) if (!x.canceled_at) orderDate.set(x.id as string, String(x.order_date))
      matches.push(...((m.data ?? []) as M[]).map(x => ({ ...x, amount: Number(x.amount ?? 0), paid_date: String(x.paid_date).slice(0, 10) })))
    }

    // 상한: 계산서 남은 금액(직접 붙인 입금 제외), 입금의 계산서 배분 잔액(범위 밖 계산서에 붙은 것 + 범위 안 직접 붙인 것 제외)
    const invCap = new Map<string, number>()
    for (const [id, v] of Array.from(inv)) invCap.set(id, Math.max(0, v.total - manual.filter(p => p.tax_invoice_id === id).reduce((s, p) => s + Math.max(0, p.amount), 0)))
    const txIds = Array.from(new Set(matches.map(m => m.source_id)))
    const txAmount = new Map<string, number>()
    const txUsed = new Map<string, number>()
    const scopeSet = new Set(scope)
    for (const ch of chunk(txIds)) {
      const [t, p] = await Promise.all([
        admin.from('transactions').select('id, amount_in').in('id', ch),
        admin.from('tax_invoice_payments').select('tax_invoice_id, transaction_id, amount, from_order_sync').in('transaction_id', ch),
      ])
      if (t.error || p.error) return out
      for (const x of t.data ?? []) txAmount.set(x.id as string, Number(x.amount_in ?? 0))
      for (const x of p.data ?? []) {
        if (x.from_order_sync && scopeSet.has(x.tax_invoice_id as string)) continue   // 이번에 다시 계산하는 넘어온 행
        txUsed.set(x.transaction_id as string, (txUsed.get(x.transaction_id as string) ?? 0) + Math.max(0, Number(x.amount ?? 0)))
      }
    }
    const txCap = new Map<string, number>()
    for (const id of txIds) txCap.set(id, Math.max(0, (txAmount.get(id) ?? 0) - (txUsed.get(id) ?? 0)))
    const manualPair = new Map<string, number>()
    for (const p of manual) manualPair.set(`${p.tax_invoice_id}|${p.transaction_id}`, Math.max(0, p.amount))

    // 있어야 할 모습: 주문(주문일 순)마다 수금(입금일 순)을 연결된 계산서(발행일 순)에 채운다
    const want = new Map<string, number>()
    const orders = Array.from(orderDate.keys()).sort((a, b) => orderDate.get(a)!.localeCompare(orderDate.get(b)!))
    for (const oid of orders) {
      const ls = links.filter(l => l.order_id === oid && inv.has(l.tax_invoice_id))
        .sort((a, b) => inv.get(a.tax_invoice_id)!.issue_date.localeCompare(inv.get(b.tax_invoice_id)!.issue_date))
        .map(l => ({ ...l }))
      const ms = matches.filter(m => m.order_id === oid).sort((a, b) => a.paid_date.localeCompare(b.paid_date))
      for (const m of ms) {
        let rest = m.amount
        for (const l of ls) {
          if (rest <= 0) break
          if (l.amount <= 0) continue
          const pair = `${l.tax_invoice_id}|${m.source_id}`
          const already = manualPair.get(pair) ?? 0
          if (already > 0) {
            // 회계가 이 계산서에 같은 입금을 직접 붙여 둠 — 그만큼은 이미 반영된 돈
            const cover = Math.min(rest, l.amount, already)
            rest -= cover; l.amount -= cover; manualPair.set(pair, already - cover)
            continue
          }
          const amt = Math.min(rest, l.amount, invCap.get(l.tax_invoice_id) ?? 0, txCap.get(m.source_id) ?? 0)
          if (amt <= 0) continue
          want.set(pair, (want.get(pair) ?? 0) + amt)
          rest -= amt; l.amount -= amt
          invCap.set(l.tax_invoice_id, (invCap.get(l.tax_invoice_id) ?? 0) - amt)
          txCap.set(m.source_id, (txCap.get(m.source_id) ?? 0) - amt)
        }
      }
    }
    // 직접 붙인 행과 같은 (계산서, 입금) 쌍에는 넘어온 행을 만들 수 없다(쌍당 1행) — 남은 것이 있어도 건너뛴다
    for (const p of manual) want.delete(`${p.tax_invoice_id}|${p.transaction_id}`)

    // 차이만 고친다
    const touched = new Set<string>()
    for (const d of derived) {
      const k = `${d.tax_invoice_id}|${d.transaction_id}`
      const w = want.get(k)
      if (!w) { await admin.from('tax_invoice_payments').delete().eq('id', d.id).eq('from_order_sync', true); out.removed++; touched.add(d.tax_invoice_id); continue }
      if (d.amount !== w) { await admin.from('tax_invoice_payments').update({ amount: w }).eq('id', d.id).eq('from_order_sync', true); touched.add(d.tax_invoice_id) }
      want.delete(k)
    }
    const inserts = Array.from(want, ([k, amount]) => { const [tax_invoice_id, transaction_id] = k.split('|'); return { tax_invoice_id, transaction_id, amount, from_order_sync: true } })
    if (inserts.length) {
      const { error } = await admin.from('tax_invoice_payments').insert(inserts)
      if (!error) { out.created = inserts.length; for (const r of inserts) touched.add(r.tax_invoice_id) }
    }

    // 계산서 상태 재계산 (부분 확인 · 확인됨). 순환 import 를 피하려고 필요할 때 불러온다
    out.invoiceIds = Array.from(touched)
    if (out.invoiceIds.length) {
      const { recalcInvoiceStatus } = await import('./tax-invoice-payments.server')
      for (const id of out.invoiceIds) await recalcInvoiceStatus(admin, id)
    }
  } catch { /* 동기화 실패는 원래 조작(수금 매칭 · 계산서 연결)에 영향을 주지 않는다 */ }
  return out
}

// 주문 수금이 바뀐 뒤 부르는 진입점 — 그 주문들에 연결된 계산서를 찾아 맞춘다. 연결이 없으면 아무 일도 하지 않는다.
export async function syncInvoicesForOrders(admin: SupabaseClient, orderIds: string[]): Promise<void> {
  try {
    const ids = Array.from(new Set(orderIds.filter(Boolean)))
    if (!ids.length || !(await linkSyncReady(admin))) return
    const invoiceIds = new Set<string>()
    for (const ch of chunk(ids)) {
      const { data, error } = await admin.from('erp_order_invoices').select('tax_invoice_id').in('order_id', ch)
      if (error) return
      for (const r of data ?? []) invoiceIds.add(r.tax_invoice_id as string)
    }
    if (invoiceIds.size) await syncInvoicePaymentsFromOrders(admin, Array.from(invoiceIds))
  } catch { /* 조용히 */ }
}
