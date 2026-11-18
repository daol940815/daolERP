import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUser } from './user-role'

// 수금 매칭의 "누가 · 언제" 와 매칭 · 해제 이력 (1307, 2026-11-18 사용자 요청)
//   매칭: erp_payment_matches.matched_by_id · matched_by_name 을 채우고(시각 = created_at) 이력에 'match' 한 줄
//   해제: 매칭 행은 지워지므로 이력에 'unmatch' 한 줄(금액 · 원본 · 사유 · 사람 · 시각)
// 1307 미적용이면 칸 없이 저장하고 이력은 건너뛴다 — 매칭 자체는 막지 않는다.
// 손으로 매칭을 저장하는 코드는 admin.from('erp_payment_matches').insert 대신 insertMatches 를 쓸 것.
export type Who = { employeeId: string | null; employeeName: string | null }
type MatchLike = { id?: unknown; order_id?: unknown; source_type?: unknown; source_id?: unknown; amount?: unknown; paid_date?: unknown; record_id?: unknown }

async function whoOf(editor?: Who | null): Promise<Who> {
  if (editor && (editor.employeeId || editor.employeeName)) return editor
  const me = await getCurrentUser().catch(() => null)
  return { employeeId: me?.employeeId ?? null, employeeName: me?.employeeName ?? null }
}

async function writeLogs(admin: SupabaseClient, action: 'match' | 'unmatch', rows: MatchLike[], who: Who, origin: string, reason?: { code: string; text: string } | null) {
  if (!rows.length) return
  try {
    const orderIds = Array.from(new Set(rows.map(r => r.order_id as string).filter(Boolean)))
    const orderNo = new Map<string, string | null>()
    for (let i = 0; i < orderIds.length; i += 150) {
      const { data } = await admin.from('erp_orders').select('id, order_no').in('id', orderIds.slice(i, i + 150))
      for (const o of data ?? []) orderNo.set(o.id as string, (o.order_no as string | null) ?? null)
    }
    await admin.from('erp_payment_match_logs').insert(rows.map(r => ({
      action, match_id: (r.id as string | undefined) ?? null, order_id: r.order_id ?? null, order_no: orderNo.get(r.order_id as string) ?? null,
      source_type: r.source_type ?? null, source_id: r.source_id ?? null, amount: r.amount ?? null, paid_date: r.paid_date ?? null, record_id: r.record_id ?? null,
      origin, reason_code: reason?.code ?? null, reason_text: reason?.text ?? null, employee_id: who.employeeId, employee_name: who.employeeName,
    })))
  } catch { /* 이력 실패는 매칭 · 해제에 영향 주지 않는다 (1307 미적용 포함) */ }
}

export async function insertMatches(admin: SupabaseClient, rows: Record<string, unknown>[], origin: string, editor?: Who | null): Promise<{ error: { message: string } | null }> {
  if (!rows.length) return { error: null }
  const who = await whoOf(editor)
  let res = await admin.from('erp_payment_matches').insert(rows.map(r => ({ ...r, matched_by_id: who.employeeId, matched_by_name: who.employeeName }))).select('id, order_id, source_type, source_id, amount, paid_date, record_id')
  if (res.error && /matched_by_id|matched_by_name|schema cache/i.test(res.error.message)) {
    res = await admin.from('erp_payment_matches').insert(rows).select('id, order_id, source_type, source_id, amount, paid_date, record_id')
  }
  if (res.error) return { error: { message: res.error.message } }
  await writeLogs(admin, 'match', (res.data ?? []) as MatchLike[], who, origin)
  return { error: null }
}

// 지우기 전에 읽어 둔 매칭 행을 넘긴다
export async function logUnmatch(admin: SupabaseClient, rows: MatchLike[], origin: string, reason: { code: string; text: string } | null, editor?: Who | null) {
  await writeLogs(admin, 'unmatch', rows, await whoOf(editor), origin, reason)
}

// 최근 해제 이력 (기록 없는 입금 탭 아래 표)
export interface UnmatchLog { id: string; order_id: string | null; order_no: string | null; source_type: string | null; amount: number | null; paid_date: string | null; origin: string | null; reason_text: string | null; employee_name: string | null; created_at: string }
export async function loadRecentUnmatches(admin: SupabaseClient, limit = 50): Promise<UnmatchLog[]> {
  const { data, error } = await admin.from('erp_payment_match_logs')
    .select('id, order_id, order_no, source_type, amount, paid_date, origin, reason_text, employee_name, created_at')
    .eq('action', 'unmatch').order('created_at', { ascending: false }).limit(limit)
  return error ? [] : ((data ?? []) as UnmatchLog[])
}
