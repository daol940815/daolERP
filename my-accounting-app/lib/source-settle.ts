import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { resolveReason } from './payment-reasons'

// ── 이전 처리분 (1309, 2026-11-23 사용자 승인 — 시안 docs/mockups/입금대장_이전처리분_시안.html) ──
// 주문 없이 이미 처리된 입금 · 카드 결제를 "처리 완료"로 표시한다(예: 기존 ERP에서 처리, 선결제 원장에 이미 반영).
// 표시된 원본은 입금대장 · 결제 확인 원본 후보 · 수금 후보에서 빠진다. 표시 · 해제 모두 사유 필수, 사람 · 시각 이력.
// 원본 · 미수 · 매출은 바뀌지 않는다. 1309 미적용이면 표시가 없는 것으로 동작한다.
export type Editor = { employeeId: string | null; employeeName: string | null }
export const MIGRATION_1309_MSG = '1309 마이그레이션(이전 처리분)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missing = (m?: string) => !!m && /payment_source_settlements|schema cache|does not exist/i.test(m)

// 살아 있는 표시: 'bank:<id>' · 'card:<id>'
export async function loadSettledKeys(admin: SupabaseClient): Promise<Set<string>> {
  const r = await fetchAllRows<{ source_type: string; source_id: string }>((f, t) =>
    admin.from('payment_source_settlements').select('source_type, source_id').is('released_at', null).range(f, t))
  return 'error' in r ? new Set() : new Set(r.data.map(x => `${x.source_type}:${x.source_id}`))
}

export interface SettleItem { source_type: 'bank' | 'card'; source_id: string; amount: number; tx_date?: string | null; label?: string | null; vendor_id?: string | null }

export async function settleSources(admin: SupabaseClient, items: SettleItem[], rawReason: unknown, memo: string | null, editor: Editor): Promise<{ error: string } | { ok: true; count: number }> {
  const reason = resolveReason('settle', rawReason)
  if ('error' in reason) return reason
  const list = items.filter(i => (i.source_type === 'bank' || i.source_type === 'card') && i.source_id)
  if (!list.length) return { error: '이전 처리분으로 표시할 입금을 체크하세요.' }
  const already = await loadSettledKeys(admin)
  const rows = list.filter(i => !already.has(`${i.source_type}:${i.source_id}`)).map(i => ({
    source_type: i.source_type, source_id: i.source_id, amount: Math.round(Number(i.amount) || 0),
    tx_date: i.tx_date ?? null, label: (i.label ?? '').slice(0, 80) || null, vendor_id: i.vendor_id ?? null,
    reason_code: reason.code, reason_text: reason.text, memo: (memo ?? '').trim().slice(0, 300) || null,
    created_by: editor.employeeId, created_by_name: editor.employeeName,
  }))
  if (!rows.length) return { ok: true, count: 0 }
  const { error } = await admin.from('payment_source_settlements').insert(rows)
  if (error) return { error: missing(error.message) ? MIGRATION_1309_MSG : error.message }
  return { ok: true, count: rows.length }
}

export async function releaseSettlements(admin: SupabaseClient, ids: string[], rawReason: unknown, editor: Editor): Promise<{ error: string } | { ok: true; count: number }> {
  const reason = resolveReason('unsettle', rawReason)
  if ('error' in reason) return reason
  if (!ids.length) return { error: '해제할 이전 처리분을 체크하세요.' }
  const { data, error } = await admin.from('payment_source_settlements').update({
    released_at: new Date().toISOString(), released_by: editor.employeeId, released_by_name: editor.employeeName,
    release_reason_code: reason.code, release_reason_text: reason.text,
  }).in('id', ids.slice(0, 500)).is('released_at', null).select('id')
  if (error) return { error: missing(error.message) ? MIGRATION_1309_MSG : error.message }
  return { ok: true, count: data?.length ?? 0 }
}

export interface SettledRow { id: string; source_type: string; source_id: string; amount: number; tx_date: string | null; label: string | null; vendor_name: string | null; reason_text: string; memo: string | null; created_by_name: string | null; created_at: string }
export async function loadSettledList(admin: SupabaseClient): Promise<{ available: boolean; rows: SettledRow[] }> {
  const r = await fetchAllRows<Record<string, unknown>>((f, t) => admin.from('payment_source_settlements')
    .select('id, source_type, source_id, amount, tx_date, label, vendor_id, reason_text, memo, created_by_name, created_at')
    .is('released_at', null).order('created_at', { ascending: false }).range(f, t))
  if ('error' in r) return { available: false, rows: [] }
  const vIds = Array.from(new Set(r.data.map(x => x.vendor_id as string).filter(Boolean)))
  const vName = new Map<string, string>()
  for (let i = 0; i < vIds.length; i += 150) {
    const { data } = await admin.from('vendors').select('id, name').in('id', vIds.slice(i, i + 150))
    for (const v of data ?? []) vName.set(v.id as string, v.name as string)
  }
  return { available: true, rows: r.data.map(x => ({ ...(x as unknown as SettledRow), amount: Number(x.amount ?? 0), vendor_name: x.vendor_id ? vName.get(x.vendor_id as string) ?? null : null })) }
}
