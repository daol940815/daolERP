import type { SupabaseClient } from '@supabase/supabase-js'

// 결제 기록의 취소 줄 (1305) — 읽기 도우미. 다른 lib 을 import 하지 않는다(순환 방지).
// 취소 줄 = order_payment_records.cancel_of 가 채워진 행. amount 는 취소 금액(양수), 주문별 금액은 order_payment_record_orders.
// 1305 미적용이면 조회가 실패하고 "취소 줄 없음"으로 동작한다.
const chunk = <T,>(a: T[], n = 150) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

export interface CancelLine {
  id: string; cancel_of: string; amount: number; pay_date: string
  reason_code: string | null; reason_text: string | null
  created_by_name: string | null; created_at: string
  confirmed_by_name: string | null; confirmed_at: string | null
  orders: { order_id: string; amount: number }[]
}

export async function hasCancelCols(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('order_payment_records').select('cancel_of').limit(1)
  return !error
}

// 이 기록들 가운데 취소 줄인 것: 취소 줄 id → 원 기록 id
export async function loadCancelRowIds(admin: SupabaseClient, recordIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const ch of chunk(Array.from(new Set(recordIds.filter(Boolean))))) {
    const { data, error } = await admin.from('order_payment_records').select('id, cancel_of').in('id', ch).not('cancel_of', 'is', null)
    if (error) return new Map()
    for (const r of data ?? []) out.set(r.id as string, r.cancel_of as string)
  }
  return out
}

// 원 기록별 취소 줄 (주문별 금액 포함, 취소일 순)
export async function loadCancelLines(admin: SupabaseClient, origIds: string[]): Promise<Map<string, CancelLine[]>> {
  const out = new Map<string, CancelLine[]>()
  const rows: CancelLine[] = []
  for (const ch of chunk(Array.from(new Set(origIds.filter(Boolean))))) {
    const { data, error } = await admin.from('order_payment_records')
      .select('id, cancel_of, amount, pay_date, reason_code, reason_text, created_by_name, created_at, confirmed_by_name, confirmed_at')
      .in('cancel_of', ch).order('pay_date').order('created_at')
    if (error) return out
    rows.push(...((data ?? []) as unknown as CancelLine[]).map(r => ({ ...r, amount: Number(r.amount ?? 0), orders: [] })))
  }
  for (const ch of chunk(rows.map(r => r.id))) {
    const { data } = await admin.from('order_payment_record_orders').select('record_id, order_id, amount').in('record_id', ch)
    for (const l of data ?? []) rows.find(r => r.id === l.record_id)?.orders.push({ order_id: l.order_id as string, amount: Number(l.amount ?? 0) })
  }
  for (const r of rows) out.set(r.cancel_of, [...(out.get(r.cancel_of) ?? []), r])
  return out
}

// 주문으로 읽은 "기록 - 주문" 행에서 취소 줄을 걸러, 원 기록의 그 주문 금액에서 뺀 결과를 돌려준다 (0 이하가 된 행은 뺀다).
// 원 기록과 취소 줄이 같은 주문에 걸려 있으므로 함께 읽힌다는 점을 쓴다.
export async function netRecordLinks<T extends { record_id: string; order_id: string; amount: number }>(admin: SupabaseClient, links: T[]): Promise<T[]> {
  if (!links.length) return links
  const cancelOf = await loadCancelRowIds(admin, links.map(l => l.record_id))
  if (!cancelOf.size) return links
  const minus = new Map<string, number>()
  for (const l of links) {
    const orig = cancelOf.get(l.record_id); if (!orig) continue
    const k = `${orig}|${l.order_id}`
    minus.set(k, (minus.get(k) ?? 0) + Number(l.amount ?? 0))
  }
  return links.filter(l => !cancelOf.has(l.record_id))
    .map(l => ({ ...l, amount: Number(l.amount ?? 0) - (minus.get(`${l.record_id}|${l.order_id}`) ?? 0) }))
    .filter(l => l.amount > 0)
}

// 수금 매칭 1건을 손으로 풀어도 되는가 (1306) — 환불(마이너스) 행과, 환불이 확정된 결제 기록의 입금 행은 풀 수 없다.
// 하나만 지우면 주문 수금이 음수가 되거나 환불이 사라진다. 막아야 하면 사유 문구, 아니면 null.
export async function refundGuard(admin: SupabaseClient, matchId: string): Promise<string | null> {
  const { data: m, error } = await admin.from('erp_payment_matches').select('amount, record_id').eq('id', matchId).maybeSingle()
  if (error || !m) return null
  if (Number(m.amount ?? 0) < 0) return '환불 출금 매칭은 여기서 풀 수 없습니다. 잘못 매칭했으면 ERP 담당에게 요청해주세요.'
  if (!m.record_id) return null
  const { data: c } = await admin.from('order_payment_records').select('id').eq('cancel_of', m.record_id as string).not('confirmed_at', 'is', null).limit(1)
  return c?.length ? '취소(환불)가 확정된 결제 기록의 수금입니다. 풀 수 없습니다.' : null
}

// 취소 계산서가 연결된 계산서들 — originals = 전액 취소된 원 계산서(연결 동기화 · 연결 후보에서 뺀다), cancels = 취소 계산서 자신.
// 일부만 취소된 원 계산서(취소 금액 합 < 계산서 합계)는 originals 에 넣지 않는다 — 남은 금액에는 입금이 다시 붙어 주문으로 넘어가야 한다.
export async function loadCanceledInvoices(admin: SupabaseClient, invoiceIds: string[]): Promise<{ originals: Set<string>; cancels: Set<string> }> {
  const out = { originals: new Set<string>(), cancels: new Set<string>() }
  const canceledSum = new Map<string, number>()
  const seen = new Set<string>()
  const add = (rows: { id: unknown; tax_invoice_id: unknown; cancels_invoice_id: unknown; amount: unknown }[] | null) => {
    for (const r of rows ?? []) {
      if (seen.has(r.id as string)) continue
      seen.add(r.id as string)
      out.cancels.add(r.tax_invoice_id as string)
      if (r.cancels_invoice_id) canceledSum.set(r.cancels_invoice_id as string, (canceledSum.get(r.cancels_invoice_id as string) ?? 0) + Math.abs(Number(r.amount ?? 0)))
    }
  }
  for (const ch of chunk(Array.from(new Set(invoiceIds.filter(Boolean))), 100)) {
    const [a, b] = await Promise.all([
      admin.from('erp_order_invoices').select('id, tax_invoice_id, cancels_invoice_id, amount').in('cancels_invoice_id', ch),
      admin.from('erp_order_invoices').select('id, tax_invoice_id, cancels_invoice_id, amount').in('tax_invoice_id', ch).not('cancels_invoice_id', 'is', null),
    ])
    if (a.error || b.error) return { originals: new Set(), cancels: new Set() }
    add(a.data); add(b.data)
  }
  for (const ch of chunk(Array.from(canceledSum.keys()), 100)) {
    const { data } = await admin.from('tax_invoices').select('id, total_amount').in('id', ch)
    for (const t of data ?? []) if ((canceledSum.get(t.id as string) ?? 0) >= Number(t.total_amount ?? 0)) out.originals.add(t.id as string)
  }
  return out
}
