import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { kstToday, type Editor } from './orders-portal'
import { hasCancelCols, loadCancelLines, loadCancelRowIds } from './payment-cancel-meta'
import { syncRecordsForOrders, writeLog, type PayMethod, type Reason } from './payment-records'
import { resolveReason } from './payment-reasons'
import { insertMatches, logLink, logUnmatch } from './match-log'

// ── 결제 기록 취소 (1305, 2026-11-18 사용자 확정 — 시안 docs/mockups/결제기록_취소_시안.html) ──
// 취소 = 실제로 실행한 결제를 되돌린 것(삭제와 다르다). 원 기록 아래에 취소 줄로 남기고, 2차에서 취소도 원본과 매칭한다.
//   카드   : 카드 매출의 취소 행(같은 승인번호)이 있어야 확정 → 원 기록의 수금 매칭을 취소 금액만큼 줄인다
//   계산서 : 취소 계산서(마이너스)를 골라 확정 → 취소 계산서를 주문에 마이너스로 연결(원 계산서 연결은 그대로 둔다),
//            원 계산서에 붙어 있던 입금을 전부 풀고(계산서를 거쳐 넘어온 주문 수금도 함께 풀린다), 원 계산서는 연결 동기화에서 빠진다
//   계좌이체: 통장의 환불 출금을 골라 확정(1306) → 입금 매칭(+)은 그대로 두고 환불 출금을 같은 주문에 마이너스 금액으로 붙인다(record_id = 취소 줄).
//            원 이체 기록이 입금과 매칭돼 있어야 확정할 수 있다(입금 없이 환불만 붙으면 수금이 음수가 된다)
// 재발행 여부는 알 수 없으므로 아무것도 자동으로 옮기지 않는다. 재발행 계산서는 새 기록 · 새 연결 · 새 입금으로 따로 붙인다.

export const MIGRATION_1305_MSG = '1305 마이그레이션(결제 기록 취소)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
export const MIGRATION_1306_MSG = '1306 마이그레이션(계좌이체 환불 매칭)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const won = (n: number) => n.toLocaleString('ko-KR')
const chunk = <T,>(a: T[], n = 150) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const toInt = (v: unknown) => Math.round(Number(String(v ?? '').replace(/,/g, '')))
const METHOD: Record<string, string> = { card: '카드결제', transfer: '계좌이체', invoice: '계산서 발행' }

type Orig = { id: string; method: PayMethod; pay_date: string; amount: number; vendor_id: string | null; approval_number: string | null; card_last4: string | null; confirmed_at: string | null; cancel_of: string | null }
const ORIG_COLS = 'id, method, pay_date, amount, vendor_id, approval_number, card_last4, confirmed_at, cancel_of'

async function linksOf(admin: SupabaseClient, recordId: string) {
  const { data } = await admin.from('order_payment_record_orders').select('order_id, amount').eq('record_id', recordId)
  return ((data ?? []) as { order_id: string; amount: number }[]).map(l => ({ order_id: l.order_id, amount: Number(l.amount ?? 0) }))
}

// ── 1차: 취소 줄 남기기 ──────────────────────────────────────────────
// body: { cancel_date, full?: boolean, allocations?: [{ order_id, amount }], reason: { code, text } }
export async function createCancel(admin: SupabaseClient, origId: string, raw: unknown, editor: Editor): Promise<{ error: string } | { ok: true; id: string }> {
  if (!(await hasCancelCols(admin))) return { error: MIGRATION_1305_MSG }
  const b = (raw ?? {}) as Record<string, unknown>
  const reason = resolveReason('cancel', b.reason)
  if ('error' in reason) return reason
  if (!isDate(b.cancel_date)) return { error: '취소일을 입력하세요.' }
  const { data: o } = await admin.from('order_payment_records').select(ORIG_COLS).eq('id', origId).maybeSingle()
  const orig = o as Orig | null
  if (!orig) return { error: '결제 기록을 찾을 수 없습니다.' }
  if (orig.cancel_of) return { error: '취소 줄은 다시 취소할 수 없습니다.' }
  if (b.cancel_date < orig.pay_date) return { error: `취소일이 결제일(${orig.pay_date})보다 앞설 수 없습니다.` }
  if (b.cancel_date > kstToday()) return { error: '취소일이 미래입니다. 실제로 취소한 날짜를 입력하세요.' }

  // 남은 금액(주문별) = 원 기록 − 이미 남긴 취소 줄
  const base = await linksOf(admin, origId)
  const lines = (await loadCancelLines(admin, [origId])).get(origId) ?? []
  const left = new Map(base.map(l => [l.order_id, l.amount - lines.reduce((x, c) => x + (c.orders.find(y => y.order_id === l.order_id)?.amount ?? 0), 0)]))
  let allocs: { order_id: string; amount: number }[]
  if (b.full) allocs = Array.from(left, ([order_id, amount]) => ({ order_id, amount })).filter(a => a.amount > 0)
  else {
    allocs = ((Array.isArray(b.allocations) ? b.allocations : []) as Record<string, unknown>[])
      .map(a => ({ order_id: String(a?.order_id ?? ''), amount: toInt(a?.amount) })).filter(a => a.order_id && Number.isFinite(a.amount) && a.amount > 0)
    for (const a of allocs) {
      const l = left.get(a.order_id)
      if (l == null) return { error: '이 결제 기록에 없는 주문입니다.' }
      if (a.amount > l) return { error: `취소할 수 있는 금액은 ${won(Math.max(0, l))}원입니다. ${won(a.amount)}원은 취소할 수 없습니다.` }
    }
  }
  if (!allocs.length) return { error: '취소할 금액이 없습니다. (이미 전액 취소됐거나 금액을 입력하지 않았습니다)' }
  const amount = allocs.reduce((x, a) => x + a.amount, 0)

  const { data: rec, error } = await admin.from('order_payment_records').insert({
    method: orig.method, pay_date: b.cancel_date, amount, vendor_id: orig.vendor_id,
    approval_number: orig.approval_number, card_last4: orig.card_last4,
    cancel_of: origId, reason_code: reason.code, reason_text: reason.text,
    created_by: editor.employeeId, created_by_name: editor.employeeName,
  }).select('id').single()
  if (error || !rec) return { error: error?.message ?? '취소 기록 저장 실패' }
  const { error: ae } = await admin.from('order_payment_record_orders').insert(allocs.map(a => ({ record_id: rec.id, order_id: a.order_id, amount: a.amount })))
  if (ae) { await admin.from('order_payment_records').delete().eq('id', rec.id); return { error: ae.message } }
  await writeLog(admin, origId, 'cancel', editor, `${METHOD[orig.method]} ${won(orig.amount)}원 중 ${won(amount)}원 취소 (${b.cancel_date})`, reason)
  return { ok: true, id: rec.id as string }
}

// ── 2차: 취소 대기열 ────────────────────────────────────────────────
export interface CancelCandidate {
  kind: 'card' | 'invoice' | 'bank'
  label: string; date: string; amount: number; note: string
  neg_invoice_id?: string; pos_invoice_id?: string
  tx_id?: string
}
export interface CancelQueueRow {
  id: string; method: PayMethod; cancel_date: string; amount: number
  reason_text: string | null; created_by_name: string | null; vendor_name: string | null
  orig: { id: string; pay_date: string; amount: number; approval_number: string | null; confirmed: boolean }
  orders: { order_id: string; order_no: string | null; amount: number }[]
  candidates: CancelCandidate[]
  note: string | null      // 후보가 없을 때의 안내
}

export async function loadCancelQueue(admin: SupabaseClient): Promise<CancelQueueRow[]> {
  // 건수 제한 없이 전부 (2026-11-18 — 제한을 넘는 취소 줄이 목록에서 빠지지 않게)
  const all = await fetchAllRows<Record<string, unknown>>((f, t) => admin.from('order_payment_records')
    .select('id, method, pay_date, amount, reason_text, created_by_name, vendor_id, cancel_of')
    .not('cancel_of', 'is', null).is('confirmed_at', null).order('pay_date').range(f, t))
  if ('error' in all || !all.data.length) return []
  const data = all.data
  type C = { id: string; method: PayMethod; pay_date: string; amount: number; reason_text: string | null; created_by_name: string | null; vendor_id: string | null; cancel_of: string }
  const cs = (data as unknown as C[]).map(c => ({ ...c, amount: Number(c.amount ?? 0) }))

  const origs = new Map<string, Orig>()
  for (const ch of chunk(Array.from(new Set(cs.map(c => c.cancel_of))))) {
    const { data: os } = await admin.from('order_payment_records').select(ORIG_COLS).in('id', ch)
    for (const o of (os ?? []) as Orig[]) origs.set(o.id, { ...o, amount: Number(o.amount ?? 0) })
  }
  const links: { record_id: string; order_id: string; amount: number }[] = []
  for (const ch of chunk(cs.map(c => c.id))) {
    const { data: ls } = await admin.from('order_payment_record_orders').select('record_id, order_id, amount').in('record_id', ch)
    links.push(...((ls ?? []) as typeof links))
  }
  const orderNo = new Map<string, string | null>()
  for (const ch of chunk(Array.from(new Set(links.map(l => l.order_id))))) {
    const { data: os } = await admin.from('erp_orders').select('id, order_no').in('id', ch)
    for (const o of os ?? []) orderNo.set(o.id as string, (o.order_no as string | null) ?? null)
  }
  const vName = new Map<string, string>()
  for (const ch of chunk(Array.from(new Set(cs.map(c => c.vendor_id).filter((x): x is string => !!x))))) {
    const { data: vs } = await admin.from('vendors').select('id, name').in('id', ch)
    for (const v of vs ?? []) vName.set(v.id as string, v.name as string)
  }
  // 이미 확정된 다른 취소 줄(같은 원 기록) — 카드 취소 잔액 계산용
  const allLines = await loadCancelLines(admin, Array.from(origs.keys()))

  // 카드: 같은 승인번호의 취소 행
  const approvals = Array.from(new Set(cs.filter(c => c.method === 'card').map(c => origs.get(c.cancel_of)?.approval_number).filter((x): x is string => !!x)))
  const cardCancel = new Map<string, { sum: number; date: string }>()
  for (const ch of chunk(approvals, 100)) {
    const { data: rows } = await admin.from('card_sales').select('approval_number, amount, tx_date').eq('transaction_type', 'cancel').in('approval_number', ch)
    for (const r of rows ?? []) {
      const cur = cardCancel.get(r.approval_number as string) ?? { sum: 0, date: '' }
      cur.sum += Math.abs(Number(r.amount ?? 0)); if (String(r.tx_date) > cur.date) cur.date = String(r.tx_date).slice(0, 10)
      cardCancel.set(r.approval_number as string, cur)
    }
  }

  // 계산서: 주문에 연결된 원 계산서(양수) → 같은 거래처의 취소 계산서(마이너스, 금액 = −취소 금액, 아직 주문에 연결 안 됨)
  const invCs = cs.filter(c => c.method === 'invoice')
  const invOrderIds = Array.from(new Set(links.filter(l => invCs.some(c => c.id === l.record_id)).map(l => l.order_id)))
  type PosLink = { order_id: string; tax_invoice_id: string; amount: number }
  const posLinks: PosLink[] = []
  for (const ch of chunk(invOrderIds)) {
    const { data: ls } = await admin.from('erp_order_invoices').select('order_id, tax_invoice_id, amount').in('order_id', ch).gt('amount', 0)
    posLinks.push(...((ls ?? []) as PosLink[]))
  }
  type Inv = { id: string; issue_date: string; total_amount: number; vendor_id: string | null; counterparty_name: string | null }
  const posInv = new Map<string, Inv>()
  for (const ch of chunk(Array.from(new Set(posLinks.map(l => l.tax_invoice_id))), 100)) {
    const { data: vs } = await admin.from('tax_invoices').select('id, issue_date, total_amount, vendor_id, counterparty_name').in('id', ch)
    for (const v of (vs ?? []) as Inv[]) posInv.set(v.id, { ...v, total_amount: Number(v.total_amount ?? 0) })
  }
  const negs: Inv[] = []
  const wantAmounts = Array.from(new Set(invCs.map(c => -c.amount)))
  for (const ch of chunk(wantAmounts, 100)) {
    const { data: vs } = await admin.from('tax_invoices').select('id, issue_date, total_amount, vendor_id, counterparty_name').eq('direction', 'sales').in('total_amount', ch).limit(1000)
    negs.push(...((vs ?? []) as Inv[]).map(v => ({ ...v, total_amount: Number(v.total_amount ?? 0) })))
  }
  const usedNeg = new Set<string>()
  for (const ch of chunk(negs.map(n => n.id), 100)) {
    const { data: ls } = await admin.from('erp_order_invoices').select('tax_invoice_id').in('tax_invoice_id', ch)
    for (const l of ls ?? []) usedNeg.add(l.tax_invoice_id as string)
  }

  // 계좌이체: 환불 출금 후보 — 출금액이 취소 금액과 같고, 원 결제일 ~ 취소일 +14일, 아직 환불로 쓰이지 않은 것
  type Tx = { id: string; tx_date: string; amount_out: number | null; counterparty_name: string | null; description: string | null }
  const trCs = cs.filter(c => c.method === 'transfer')
  const outs: Tx[] = []
  if (trCs.length) {
    const from = trCs.reduce((m, c) => { const d = origs.get(c.cancel_of)?.pay_date ?? c.pay_date; return d < m ? d : m }, '9999-12-31')
    for (const ch of chunk(Array.from(new Set(trCs.map(c => c.amount))), 100)) {
      const { data: ts } = await admin.from('transactions').select('id, tx_date, amount_out, counterparty_name, description')
        .in('amount_out', ch).gte('tx_date', from).order('tx_date').limit(1000)
      outs.push(...((ts ?? []) as Tx[]))
    }
  }
  const usedOut = new Set<string>()
  for (const ch of chunk(outs.map(t => t.id))) {
    const { data: ms } = await admin.from('erp_payment_matches').select('source_id').eq('source_type', 'bank').in('source_id', ch)
    for (const m of ms ?? []) usedOut.add(m.source_id as string)
  }
  const plusDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

  return cs.map(c => {
    const orig = origs.get(c.cancel_of)
    const orders = links.filter(l => l.record_id === c.id).map(l => ({ order_id: l.order_id, order_no: orderNo.get(l.order_id) ?? null, amount: Number(l.amount ?? 0) }))
    const candidates: CancelCandidate[] = []
    let note: string | null = null
    if (c.method === 'card') {
      const src = orig?.approval_number ? cardCancel.get(orig.approval_number) : undefined
      const done = (allLines.get(c.cancel_of) ?? []).filter(l => l.confirmed_at).reduce((x, l) => x + l.amount, 0)
      const free = (src?.sum ?? 0) - done
      if (src && free >= c.amount) candidates.push({ kind: 'card', label: '카드 매출 취소', date: src.date, amount: free, note: `승인번호 일치 · 원본 취소 ${won(src.sum)}원${done ? ` (이미 확정 ${won(done)}원)` : ''}` })
      else note = src ? `카드 매출의 취소 금액이 부족합니다 — 원본 취소 ${won(src.sum)}원 · 이미 확정 ${won(done)}원` : '카드 매출에 이 승인번호의 취소 내역이 아직 없습니다'
    } else if (c.method === 'invoice') {
      const mine = new Set(orders.map(o => o.order_id))
      const ps = Array.from(new Set(posLinks.filter(l => mine.has(l.order_id)).map(l => l.tax_invoice_id))).map(id => posInv.get(id)).filter((x): x is Inv => !!x)
      for (const p of ps) {
        for (const n of negs) {
          if (usedNeg.has(n.id) || n.total_amount !== -c.amount || n.issue_date < p.issue_date) continue
          if ((n.vendor_id ?? `n:${n.counterparty_name}`) !== (p.vendor_id ?? `n:${p.counterparty_name}`)) continue
          candidates.push({
            kind: 'invoice', label: `취소 계산서 ${n.counterparty_name ?? ''}`.trim(), date: n.issue_date.slice(0, 10), amount: n.total_amount,
            note: `원 계산서 ${p.issue_date.slice(0, 10)} ${won(p.total_amount)}원의 취소${-n.total_amount === p.total_amount ? '' : ' (일부 금액)'}`,
            neg_invoice_id: n.id, pos_invoice_id: p.id,
          })
        }
      }
      if (!candidates.length) note = ps.length ? '홈택스에 금액이 맞는 취소 계산서가 아직 없습니다' : '이 주문에 연결된 원 계산서가 없습니다 — 원 계산서부터 주문에 연결해야 취소 계산서를 붙일 수 있습니다'
    } else {
      if (!orig?.confirmed_at) note = '원 이체 기록이 아직 입금과 매칭되지 않았습니다 — 아래 매칭 대기에서 입금부터 확정하세요'
      else {
        for (const t of outs) {
          const d = String(t.tx_date).slice(0, 10)
          if (usedOut.has(t.id) || Number(t.amount_out ?? 0) !== c.amount || d < orig.pay_date || d > plusDays(c.pay_date, 14)) continue
          const who = (t.counterparty_name || t.description || '').trim()
          candidates.push({ kind: 'bank', label: `통장 출금 ${who.slice(0, 20)}`.trim(), date: d, amount: -c.amount, note: `금액 일치 · 취소일 ${c.pay_date}`, tx_id: t.id })
        }
        candidates.sort((x, y) => Math.abs(new Date(x.date).getTime() - new Date(c.pay_date).getTime()) - Math.abs(new Date(y.date).getTime() - new Date(c.pay_date).getTime()))
        if (!candidates.length) note = '통장에 금액이 맞는 환불 출금이 아직 없습니다 (원 결제일 ~ 취소일 +14일)'
      }
    }
    return {
      id: c.id, method: c.method, cancel_date: c.pay_date, amount: c.amount, reason_text: c.reason_text, created_by_name: c.created_by_name,
      vendor_name: c.vendor_id ? vName.get(c.vendor_id) ?? null : null,
      orig: { id: c.cancel_of, pay_date: orig?.pay_date ?? '', amount: orig?.amount ?? 0, approval_number: orig?.approval_number ?? null, confirmed: !!orig?.confirmed_at },
      orders, candidates: candidates.slice(0, 5), note,
    }
  })
}

// ── 2차: 취소 확정 ──────────────────────────────────────────────────
// body: 카드 = {} / 계산서 = { neg_invoice_id, pos_invoice_id } / 계좌이체 = { tx_id }
export async function confirmCancel(admin: SupabaseClient, cancelId: string, raw: unknown, editor: Editor): Promise<{ error: string } | { ok: true; message: string; orderIds: string[] }> {
  const b = (raw ?? {}) as Record<string, unknown>
  const { data: c0 } = await admin.from('order_payment_records').select(ORIG_COLS).eq('id', cancelId).maybeSingle()
  const c = c0 as Orig | null
  if (!c || !c.cancel_of) return { error: '취소 기록을 찾을 수 없습니다.' }
  if (c.confirmed_at) return { error: '이미 확정된 취소입니다.' }
  const { data: o0 } = await admin.from('order_payment_records').select(ORIG_COLS).eq('id', c.cancel_of).maybeSingle()
  const orig = o0 as Orig | null
  if (!orig) return { error: '원 결제 기록을 찾을 수 없습니다.' }
  const allocs = await linksOf(admin, cancelId)
  const amount = Number(c.amount)
  const orderIds = allocs.map(a => a.order_id)
  const stamp = { confirmed_by: editor.employeeId, confirmed_by_name: editor.employeeName, confirmed_at: new Date().toISOString() }
  let message = ''

  if (c.method === 'card') {
    if (!orig.approval_number) return { error: '원 기록에 승인번호가 없어 카드 취소를 대조할 수 없습니다.' }
    const { data: rows } = await admin.from('card_sales').select('amount').eq('transaction_type', 'cancel').eq('approval_number', orig.approval_number)
    const srcCancel = (rows ?? []).reduce((x, r) => x + Math.abs(Number(r.amount ?? 0)), 0)
    const done = ((await loadCancelLines(admin, [orig.id])).get(orig.id) ?? []).filter(l => l.confirmed_at).reduce((x, l) => x + l.amount, 0)
    if (srcCancel - done < amount) return { error: `카드 매출의 취소 금액(${won(srcCancel)}원${done ? `, 이미 확정 ${won(done)}원` : ''})이 이 취소(${won(amount)}원)보다 적습니다. 카드 매출 파일에 취소 내역이 올라온 뒤 확정하세요.` }
    // 원 기록이 매칭돼 있으면 그 수금 매칭을 주문별 취소 금액만큼 줄인다 (미수가 되살아난다)
    let reduced = 0
    for (const a of allocs) {
      const { data: ms } = await admin.from('erp_payment_matches').select('id, amount').eq('record_id', orig.id).eq('order_id', a.order_id).order('created_at', { ascending: false })
      let rest = a.amount
      for (const m of ms ?? []) {
        if (rest <= 0) break
        const cur = Number(m.amount ?? 0), cut = Math.min(cur, rest)
        const res = cut === cur ? await admin.from('erp_payment_matches').delete().eq('id', m.id) : await admin.from('erp_payment_matches').update({ amount: cur - cut }).eq('id', m.id)
        if (res.error) return { error: res.error.message }
        await logUnmatch(admin, [{ id: m.id, order_id: a.order_id, source_type: 'card', amount: cut, record_id: orig.id }], '카드 취소 확정 — 수금 매칭 감액', { code: 'etc', text: '카드 취소' }, editor)
        rest -= cut; reduced += cut
      }
    }
    message = reduced > 0 ? `카드 취소를 확정했습니다 — 수금 매칭 ${won(reduced)}원을 줄여 주문 미수가 그만큼 늘었습니다.` : '카드 취소를 확정했습니다 — 원 기록이 매칭 전이라 미수는 그대로입니다.'
  } else if (c.method === 'invoice') {
    const negId = String(b.neg_invoice_id ?? ''), posId = String(b.pos_invoice_id ?? '')
    if (!negId || !posId) return { error: '취소 계산서를 고르세요.' }
    const { data: invs } = await admin.from('tax_invoices').select('id, direction, total_amount, issue_date, vendor_id, counterparty_name').in('id', [negId, posId])
    const neg = (invs ?? []).find(v => v.id === negId), pos = (invs ?? []).find(v => v.id === posId)
    if (!neg || !pos) return { error: '계산서를 찾을 수 없습니다. 화면을 새로 고쳐 주세요.' }
    if (neg.direction !== 'sales' || Number(neg.total_amount) !== -amount) return { error: `취소 계산서 금액(${won(Number(neg.total_amount))}원)이 취소 기록(−${won(amount)}원)과 다릅니다.` }
    if (Number(pos.total_amount) <= 0 || (pos.vendor_id ?? pos.counterparty_name) !== (neg.vendor_id ?? neg.counterparty_name)) return { error: '원 계산서와 취소 계산서의 거래처가 다릅니다.' }
    const { data: used } = await admin.from('erp_order_invoices').select('id').eq('tax_invoice_id', negId).limit(1)
    if (used?.length) return { error: '이미 다른 주문에 연결된 취소 계산서입니다. 화면을 새로 고쳐 주세요.' }
    const { data: pl } = await admin.from('erp_order_invoices').select('order_id, amount').eq('tax_invoice_id', posId).gt('amount', 0)
    const posByOrder = new Map((pl ?? []).map(l => [l.order_id as string, Number(l.amount ?? 0)]))
    for (const a of allocs) if ((posByOrder.get(a.order_id) ?? 0) < a.amount) return { error: '원 계산서가 이 주문에 그만큼 연결돼 있지 않습니다. 원 계산서부터 주문에 연결하세요.' }

    // ① 취소 계산서를 주문에 마이너스로 연결 (원 계산서 연결은 그대로 — 둘 다 주문 내역에 남는다)
    const { error: ie } = await admin.from('erp_order_invoices').insert(allocs.map(a => ({
      order_id: a.order_id, tax_invoice_id: negId, amount: -a.amount, issue_date: String(neg.issue_date).slice(0, 10),
      matched_by: 'manual', memo: '취소 계산서', cancel_record_id: cancelId, cancels_invoice_id: posId,
    })))
    if (ie) return { error: /cancel_record_id|cancels_invoice_id|amount_check|schema cache/i.test(ie.message) ? MIGRATION_1305_MSG : ie.message }
    // ② 원 계산서에 붙어 있던 입금을 전부 푼다 → 계산서를 거쳐 넘어와 있던 주문 수금도 함께 풀린다(원 계산서는 이제 동기화 대상이 아니다)
    const { data: cr } = await admin.from('order_payment_records').select('reason_code, reason_text').eq('id', cancelId).maybeSingle()
    const why = cr?.reason_text ? { code: (cr.reason_code as string | null) ?? 'etc', text: `계산서 취소 — ${cr.reason_text}` } : { code: 'etc', text: '계산서 취소' }
    const { data: payRows } = await admin.from('tax_invoice_payments').select('id, transaction_id, amount').eq('tax_invoice_id', posId)
    const payCount = payRows?.length ?? 0
    await admin.from('tax_invoice_payments').delete().eq('tax_invoice_id', posId)
    await logLink(admin, 'unmatch', (payRows ?? []).map(p => ({ id: p.id, source_type: 'invoice_payment', source_id: p.transaction_id, amount: p.amount })), '계산서 취소 — 원 계산서 입금 해제', why, editor)
    const { syncOrderMatchesFromInvoices } = await import('./link-sync')
    const { recalcInvoiceStatus } = await import('./tax-invoice-payments.server')
    await recalcInvoiceStatus(admin, posId)
    const sync = await syncOrderMatchesFromInvoices(admin, [posId], '계산서 취소', why)
    // ③ 결제 확인에서 이 계산서 발행 기록을 통장 입금에 직접 확정해 둔 수금도 푼다
    const { data: direct } = await admin.from('erp_payment_matches').select('id, amount, order_id, source_type, source_id, paid_date, record_id').eq('record_id', orig.id).in('order_id', orderIds)
    const directSum = (direct ?? []).reduce((x, m) => x + Number(m.amount ?? 0), 0)
    if (direct?.length) { await admin.from('erp_payment_matches').delete().in('id', direct.map(m => m.id as string)); await logUnmatch(admin, direct, '계산서 취소 — 발행 기록의 수금 해제', why, editor) }
    // ④ 전액 취소면 두 계산서를 상계(확인됨)로 표시 — 주고받을 돈이 없는 쌍
    if (Number(pos.total_amount) === amount) {
      const memo = '취소발행 상계 — 주문 취소 기록에서 확인'
      const up = await admin.from('tax_invoices').update({ payment_status: 'matched', payment_manual: true, payment_memo: memo }).in('id', [posId, negId])
      if (up.error) await admin.from('tax_invoices').update({ payment_status: 'matched', payment_memo: memo }).in('id', [posId, negId])
    }
    const freed = sync.removed > 0 || directSum > 0 || payCount > 0
    message = `취소 계산서를 주문에 연결했습니다.${freed ? ` 원 계산서에 붙어 있던 입금 ${payCount}건을 풀었고, 주문 미수가 다시 생겼습니다. 풀린 입금은 미연결 입금으로 돌아갑니다.` : ' 원 계산서에 붙은 입금은 없었습니다.'}`
  } else {
    // 계좌이체 환불 (1306): 입금 매칭은 그대로 두고, 환불 출금을 같은 주문에 마이너스 금액으로 붙인다
    const txId = String(b.tx_id ?? '')
    if (!txId) return { error: '환불 출금을 고르세요.' }
    if (!orig.confirmed_at) return { error: '원 이체 기록이 아직 입금과 매칭되지 않았습니다. 입금부터 확정한 뒤 환불을 매칭하세요.' }
    const { data: tx } = await admin.from('transactions').select('id, tx_date, amount_out').eq('id', txId).maybeSingle()
    if (!tx || !(Number(tx.amount_out ?? 0) > 0)) return { error: '통장 출금 내역을 찾을 수 없습니다.' }
    const { data: used } = await admin.from('erp_payment_matches').select('amount').eq('source_type', 'bank').eq('source_id', txId)
    const usedSum = (used ?? []).reduce((x, m) => x + Math.abs(Number(m.amount ?? 0)), 0)
    if (Number(tx.amount_out) - usedSum < amount) return { error: `이 출금의 남은 금액(${won(Number(tx.amount_out) - usedSum)}원)이 환불 금액(${won(amount)}원)보다 적습니다.` }
    // 주문별로, 이 기록이 그 주문에서 실제로 수금한 금액을 넘겨 환불할 수 없다 (수금이 음수가 되지 않게)
    const { data: plus } = await admin.from('erp_payment_matches').select('order_id, amount').eq('record_id', orig.id).in('order_id', orderIds)
    const got = new Map<string, number>()
    for (const m of plus ?? []) got.set(m.order_id as string, (got.get(m.order_id as string) ?? 0) + Number(m.amount ?? 0))
    const doneLines = ((await loadCancelLines(admin, [orig.id])).get(orig.id) ?? []).filter(l => l.confirmed_at)
    for (const a of allocs) {
      const back = doneLines.reduce((x, l) => x + (l.orders.find(o => o.order_id === a.order_id)?.amount ?? 0), 0)
      if ((got.get(a.order_id) ?? 0) - back < a.amount) return { error: '이 주문에서 수금한 금액보다 큰 환불입니다. 원 이체 기록의 매칭 상태를 확인하세요.' }
    }
    const { error: ie } = await insertMatches(admin, allocs.map(a => ({
      order_id: a.order_id, source_type: 'bank', source_id: txId, amount: -a.amount, paid_date: String(tx.tx_date).slice(0, 10),
      matched_by: 'manual', record_id: cancelId, memo: ['이체 환불', editor.employeeName].filter(Boolean).join(' · '),
    })), '이체 환불 매칭', editor)
    if (ie) return { error: /amount_check|violates check/i.test(ie.message) ? MIGRATION_1306_MSG : ie.message }
    message = `환불 출금을 매칭했습니다 — 입금은 그대로 두고 환불 ${won(amount)}원을 주문에 붙여 미수가 그만큼 늘었습니다.`
  }

  const { error: ue } = await admin.from('order_payment_records').update(stamp).eq('id', cancelId).is('confirmed_at', null)
  if (ue) return { error: ue.message }
  await writeLog(admin, orig.id, 'cancel_confirm', editor, `${METHOD[c.method]} 취소 ${won(amount)}원 매칭`)
  // 원 기록의 확정 상태를 다시 맞춘다 (덮는 매칭이 사라졌으면 자동 해제)
  await syncRecordsForOrders(admin, orderIds, editor, '결제 취소 확정')
  return { ok: true, message, orderIds }
}

// 취소 줄 삭제(잘못 남긴 취소) — 확정 전만. 사유는 원 기록 이력에 남긴다.
export async function isCancelRow(admin: SupabaseClient, recordId: string): Promise<string | null> {
  return (await loadCancelRowIds(admin, [recordId])).get(recordId) ?? null
}
export type { Reason }
