import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { syncTransactionJournal } from './journal/bank-posting'
import type { Editor } from './orders-portal'

// ── 증빙 없이 처리 (1310, 2026-11-25 사용자 결정 — 시안 docs/mockups/증빙없이처리_현금매출_시안.html) ──
// 계산서 · 현금영수증 없이 통장 입금으로 받은 주문을 "증빙 없이 처리"로 확인한다.
//   처리 = ① 주문에 붙은 통장 입금 중 분류 전인 것을 상품매출(4001)로 확정(분개 생성 — 통장 내역 확정과 같은 동작)
//          ② 입금별 처리 기록(과세분 · 면세분 · 사유 · 누가 · 언제)
//   막음 = 입금이 이미 다른 계정으로 분류(확정 · 검토)돼 있으면 처리하지 않는다 — 기확정 값을 덮어쓰지 않는다.
//   해제 = 사유 필수. 이 처리로 확정한 입금만 처리 전 상태로 되돌린다(분개도 취소).
// 과세분은 예상 부가세 "현금 매출(자동)"에 입금일 달로 들어간다(공급가 = 과세분 ÷ 1.1, 원 단위 반올림). 면세분은 참고 표시.
// 결정: 귀속 = 입금일 · 과세 구분 기본 = 과세 · 처리 권한 = 수금 · 정산 수정 권한자.

export type NoEvidenceVat = 'taxable' | 'exempt' | 'mixed'
export const NO_EVIDENCE_VAT_LABEL: Record<NoEvidenceVat, string> = { taxable: '과세', exempt: '면세', mixed: '과세 · 면세 섞임' }
export const MIGRATION_1310_MSG = '1310 마이그레이션(증빙 없이 처리)이 아직 적용되지 않았습니다. SQL 편집기에서 1310_order_no_evidence.sql을 실행해주세요.'
export const isMissing1310 = (msg: string | null | undefined) => !!msg && /order_no_evidence|42P01|schema cache/i.test(msg)

const SALES_CODE = '4001'
const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const won = (n: number) => n.toLocaleString('ko-KR')

// 부가세 포함 과세분 → 공급가 · 세액
export const splitTaxable = (amount: number) => { const supply = Math.round(amount / 1.1); return { supply, tax: amount - supply } }

// 주문에 붙은 통장 입금(입금별 합계 — 환불 마이너스 매칭은 상계)
async function bankDepositsOfOrder(admin: SupabaseClient, orderId: string): Promise<{ error: string } | { data: { transaction_id: string; amount: number; paid_date: string }[] }> {
  const { data, error } = await admin.from('erp_payment_matches').select('source_id, amount, paid_date').eq('order_id', orderId).eq('source_type', 'bank')
  if (error) return { error: error.message }
  const by = new Map<string, { transaction_id: string; amount: number; paid_date: string }>()
  for (const m of data ?? []) {
    const k = m.source_id as string
    const cur = by.get(k) ?? { transaction_id: k, amount: 0, paid_date: String(m.paid_date).slice(0, 10) }
    cur.amount += Number(m.amount ?? 0)
    by.set(k, cur)
  }
  return { data: Array.from(by.values()).filter(d => d.amount > 0).sort((a, b) => a.paid_date.localeCompare(b.paid_date)) }
}

export interface ProcessInput { vat_kind: NoEvidenceVat; taxable_amount?: number | null; reason: { code: string; text: string } }

export async function processNoEvidence(admin: SupabaseClient, orderId: string, input: ProcessInput, editor: Editor, authUserId: string | null):
  Promise<{ error: string } | { ok: true; deposits: number; confirmed: number; amount: number; journal_errors: string[] }> {
  const live = await admin.from('order_no_evidence').select('id').eq('order_id', orderId).is('released_at', null).limit(1)
  if (live.error) return { error: isMissing1310(live.error.message) ? MIGRATION_1310_MSG : live.error.message }
  if ((live.data ?? []).length) return { error: '이미 증빙 없이 처리된 주문입니다. 다시 처리하려면 먼저 해제하세요.' }

  const { count: invCount } = await admin.from('erp_order_invoices').select('id', { count: 'exact', head: true }).eq('order_id', orderId)
  if ((invCount ?? 0) > 0) return { error: '이 주문에는 계산서가 연결돼 있습니다. 증빙 없이 처리할 대상이 아닙니다.' }

  const deps = await bankDepositsOfOrder(admin, orderId)
  if ('error' in deps) return { error: deps.error }
  if (!deps.data.length) return { error: '이 주문에 붙은 통장 입금이 없습니다.' }
  const txIds = deps.data.map(d => d.transaction_id)

  // 현금영수증이 붙은 입금이면 증빙이 있는 것이다
  const { count: rcCount } = await admin.from('cash_receipt_payments').select('id', { count: 'exact', head: true }).in('transaction_id', txIds)
  if ((rcCount ?? 0) > 0) return { error: '이 주문의 입금에 현금영수증이 연결돼 있습니다. 증빙 없이 처리할 대상이 아닙니다.' }

  const { data: acc } = await admin.from('accounts').select('id').eq('code', SALES_CODE).maybeSingle()
  if (!acc) return { error: '상품매출(4001) 계정을 찾을 수 없습니다.' }
  const salesId = acc.id as string

  const { data: txs, error: te } = await admin.from('transactions').select('id, tx_date, status, confirmed_account_id, transfer_pair_id, counterparty_name, accounts:confirmed_account_id(code, name)').in('id', txIds)
  if (te) return { error: te.message }
  const txById = new Map((txs ?? []).map(t => [t.id as string, t]))
  for (const d of deps.data) {
    const t = txById.get(d.transaction_id)
    if (!t) return { error: '통장 입금 내역을 찾을 수 없습니다.' }
    if (t.transfer_pair_id) return { error: `입금 ${d.paid_date} ${won(d.amount)}원은 계좌 간 이체입니다. 매출 입금이 아닙니다.` }
    const accId = t.confirmed_account_id as string | null
    if (accId && accId !== salesId) {
      const a = t.accounts as unknown as { code: string; name: string } | null
      return { error: `입금 ${d.paid_date} ${won(d.amount)}원이 이미 ${a ? `${a.name}(${a.code})` : '다른 계정'}으로 ${t.status === 'confirmed' ? '확정' : '분류'}돼 있습니다. 증빙 없는 매출은 상품매출로 확정해야 합니다 — 통장 내역에서 분류를 비우거나 상품매출로 바꾼 뒤 다시 처리하세요.` }
    }
  }

  // 과세 · 면세 나누기 — 섞임은 과세분 합계를 입금일순으로 채운다
  const total = deps.data.reduce((s, d) => s + d.amount, 0)
  let taxLeft: number
  if (input.vat_kind === 'taxable') taxLeft = total
  else if (input.vat_kind === 'exempt') taxLeft = 0
  else {
    const t = Math.round(Number(input.taxable_amount ?? NaN))
    if (!Number.isFinite(t) || t <= 0 || t >= total) return { error: `과세 · 면세 섞임은 과세분을 0보다 크고 입금 합계(${won(total)}원)보다 작게 입력하세요.` }
    taxLeft = t
  }

  const now = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  let confirmed = 0
  const journalErrors: string[] = []
  for (const d of deps.data) {
    const t = txById.get(d.transaction_id)!
    const taxable = Math.min(taxLeft, d.amount); taxLeft -= taxable
    const needConfirm = !(t.status === 'confirmed' && t.confirmed_account_id === salesId)
    if (needConfirm) {
      const { error: ue } = await admin.from('transactions').update({
        confirmed_account_id: salesId, status: 'confirmed',
        ...(t.status !== 'confirmed' ? { confirmed_at: now, confirmed_by: authUserId } : {}),
      }).eq('id', d.transaction_id)
      if (ue) { await rollbackTx(admin, rows); return { error: ue.message } }
      const jr = await syncTransactionJournal(admin, d.transaction_id)
      if ('error' in jr) journalErrors.push(`${d.paid_date} ${won(d.amount)}원: ${jr.error}`)
      confirmed++
    }
    rows.push({
      order_id: orderId, transaction_id: d.transaction_id, paid_date: d.paid_date, amount: d.amount,
      vat_kind: input.vat_kind, taxable_amount: taxable, exempt_amount: d.amount - taxable,
      reason_code: input.reason.code, reason_text: input.reason.text,
      confirmed_by_us: needConfirm, prev_status: needConfirm ? (t.status as string) : null, prev_account_id: needConfirm ? (t.confirmed_account_id as string | null) : null,
      created_by: editor.employeeId, created_by_name: editor.employeeName,
    })
  }
  const { error: ie } = await admin.from('order_no_evidence').insert(rows)
  if (ie) { await rollbackTx(admin, rows); return { error: isMissing1310(ie.message) ? MIGRATION_1310_MSG : ie.message } }
  return { ok: true, deposits: rows.length, confirmed, amount: total, journal_errors: journalErrors }
}

// 처리 실패 시 이 처리로 확정한 입금을 되돌린다
async function rollbackTx(admin: SupabaseClient, rows: Record<string, unknown>[]) {
  for (const r of rows) {
    if (!r.confirmed_by_us) continue
    await admin.from('transactions').update({ status: r.prev_status ?? 'pending', confirmed_account_id: r.prev_account_id ?? null }).eq('id', r.transaction_id as string)
    await syncTransactionJournal(admin, r.transaction_id as string)
  }
}

export async function releaseNoEvidence(admin: SupabaseClient, orderId: string, reason: { code: string; text: string }, editor: Editor):
  Promise<{ error: string } | { ok: true; restored: number }> {
  const { data, error } = await admin.from('order_no_evidence').select('id, transaction_id, confirmed_by_us, prev_status, prev_account_id').eq('order_id', orderId).is('released_at', null)
  if (error) return { error: isMissing1310(error.message) ? MIGRATION_1310_MSG : error.message }
  if (!data?.length) return { error: '증빙 없이 처리된 기록이 없습니다.' }
  const { error: ue } = await admin.from('order_no_evidence').update({
    released_at: new Date().toISOString(), released_by: editor.employeeId, released_by_name: editor.employeeName,
    release_reason_code: reason.code, release_reason_text: reason.text,
  }).in('id', data.map(d => d.id as string))
  if (ue) return { error: ue.message }
  // 이 처리로 확정한 입금 → 처리 전 상태로. 다른 주문의 살아 있는 처리가 같은 입금을 쓰면 그대로 둔다
  let restored = 0
  for (const r of data.filter(d => d.confirmed_by_us)) {
    const { count } = await admin.from('order_no_evidence').select('id', { count: 'exact', head: true }).eq('transaction_id', r.transaction_id as string).is('released_at', null)
    if ((count ?? 0) > 0) continue
    await admin.from('transactions').update({ status: (r.prev_status as string | null) ?? 'pending', confirmed_account_id: (r.prev_account_id as string | null) ?? null }).eq('id', r.transaction_id as string)
    await syncTransactionJournal(admin, r.transaction_id as string)
    restored++
  }
  return { ok: true, restored }
}

export interface NoEvidenceRow {
  order_id: string; transaction_id: string; paid_date: string; amount: number
  vat_kind: NoEvidenceVat; taxable_amount: number; exempt_amount: number
  reason_text: string; created_by_name: string | null; created_at: string
}

// 살아 있는 처리 — 기간(입금일) 조건은 선택
export async function loadLiveNoEvidence(admin: SupabaseClient, from?: string | null, to?: string | null): Promise<{ available: boolean; rows: NoEvidenceRow[] }> {
  const res = await fetchAllRows<NoEvidenceRow>((f, t) => {
    let q = admin.from('order_no_evidence').select('order_id, transaction_id, paid_date, amount, vat_kind, taxable_amount, exempt_amount, reason_text, created_by_name, created_at').is('released_at', null)
    if (from) q = q.gte('paid_date', from)
    if (to) q = q.lte('paid_date', to)
    return q.order('paid_date', { ascending: false }).range(f, t)
  })
  if ('error' in res) return { available: !isMissing1310(res.error), rows: [] }
  return { available: true, rows: res.data.map(r => ({ ...r, amount: Number(r.amount), taxable_amount: Number(r.taxable_amount), exempt_amount: Number(r.exempt_amount) })) }
}

// 처리된 주문에 나중에 증빙이 생겼는지 — 계산서 연결 또는 입금에 현금영수증 연결
export async function evidenceAppeared(admin: SupabaseClient, rows: NoEvidenceRow[]): Promise<Set<string>> {
  const out = new Set<string>()
  const orderIds = Array.from(new Set(rows.map(r => r.order_id)))
  for (const ch of chunk(orderIds, 150)) {
    const { data } = await admin.from('erp_order_invoices').select('order_id').in('order_id', ch)
    for (const d of data ?? []) out.add(d.order_id as string)
  }
  const txIds = Array.from(new Set(rows.map(r => r.transaction_id)))
  const txWithReceipt = new Set<string>()
  for (const ch of chunk(txIds, 150)) {
    const { data } = await admin.from('cash_receipt_payments').select('transaction_id').in('transaction_id', ch)
    for (const d of data ?? []) txWithReceipt.add(d.transaction_id as string)
  }
  for (const r of rows) if (txWithReceipt.has(r.transaction_id)) out.add(r.order_id)
  return out
}
