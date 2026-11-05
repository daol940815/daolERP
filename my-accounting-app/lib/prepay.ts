import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetch-all-rows'
import { kstToday, writeEditLogs, type Editor } from './orders-portal'
import { loadReceivableMap } from './orders-portal-list'

// ── 선결제 사용 (514, 2026-11-05 사용자 확정 — 시안 docs/mockups/선결제_사용_시안.html) ──
// 선결제 사용 = 주문 결제 수단 하나. 사용 1건 =
//   ① erp_prepayments 차감(deduction, order_id 연결) + ② erp_payment_matches(source_type 'prepay', source_id = ①.id)
// ②로 표준 미수가 통장·카드처럼 줄어든다(뷰 규칙 불변). 해제는 ①②를 함께 지운다.
// 확정 규칙(가안): 주문 상세에서만 사용 · 잔액 초과 차단 · 미수 초과 차단 · 해제는 주문 수정 권한자 누구나(변경 이력 기록).
// 잔액은 매출처(vendor) 단위 = 그 거래처의 모든 매출처 별칭 원장 합 (매출처 허브 선결제 원장과 같은 기준).

const won = (n: number) => n.toLocaleString('ko-KR')

export interface PrepayBalance { vendor_id: string | null; deposit: number; deduction: number; balance: number }

async function aliasIdsOfVendor(admin: SupabaseClient, vendorId: string): Promise<string[]> {
  const { data } = await admin.from('erp_vendor_aliases')
    .select('id').eq('vendor_id', vendorId).eq('alias_type', 'customer')
  return (data ?? []).map(a => a.id as string)
}

// 주문의 거래처: direct는 erp_orders.vendor_id, 없으면 매출처 별칭의 vendor_id
export async function vendorOfOrder(admin: SupabaseClient, order: { vendor_id?: unknown; customer_alias_id?: unknown }): Promise<string | null> {
  if (order.vendor_id) return order.vendor_id as string
  if (!order.customer_alias_id) return null
  const { data } = await admin.from('erp_vendor_aliases').select('vendor_id').eq('id', order.customer_alias_id as string).maybeSingle()
  return (data?.vendor_id as string | null) ?? null
}

export async function prepayBalanceOf(admin: SupabaseClient, vendorId: string | null, extraAliasId?: string | null): Promise<PrepayBalance> {
  const aliasIds = vendorId ? await aliasIdsOfVendor(admin, vendorId) : []
  if (extraAliasId && !aliasIds.includes(extraAliasId)) aliasIds.push(extraAliasId)
  const out: PrepayBalance = { vendor_id: vendorId, deposit: 0, deduction: 0, balance: 0 }
  if (!aliasIds.length) return out
  const r = await fetchAllRows<{ entry_type: string; amount: number | null }>((f, t) =>
    admin.from('erp_prepayments').select('entry_type, amount')
      .eq('direction', 'customer').in('alias_id', aliasIds).range(f, t))
  if ('error' in r) return out
  for (const e of r.data) {
    const a = Number(e.amount ?? 0)
    if (e.entry_type === 'deposit') out.deposit += a
    else out.deduction += a
  }
  out.balance = out.deposit - out.deduction
  return out
}

// 이 주문에 붙은 선결제 사용 합계
export async function prepayUsedOf(admin: SupabaseClient, orderId: string): Promise<number> {
  const { data } = await admin.from('erp_payment_matches').select('amount')
    .eq('order_id', orderId).eq('source_type', 'prepay')
  return (data ?? []).reduce((s, m) => s + Number(m.amount ?? 0), 0)
}

type OrderRow = { id: string; order_no: string | null; source: string | null; canceled_at: string | null; vendor_id: string | null; customer_alias_id: string | null }

async function loadOrder(admin: SupabaseClient, orderId: string): Promise<OrderRow | null> {
  const { data } = await admin.from('erp_orders')
    .select('id, order_no, source, canceled_at, vendor_id, customer_alias_id').eq('id', orderId).maybeSingle()
  return (data as OrderRow | null) ?? null
}

export async function applyPrepayUse(
  admin: SupabaseClient, orderId: string, rawAmount: unknown, memo: string | null, editor: Editor,
): Promise<{ error: string } | { ok: true; balance: number; outstanding: number }> {
  const order = await loadOrder(admin, orderId)
  if (!order) return { error: '주문을 찾을 수 없습니다.' }
  if (order.source !== 'direct') return { error: '업로드 주문에는 선결제를 사용할 수 없습니다.' }
  if (order.canceled_at) return { error: '취소된 주문입니다.' }
  if (!order.customer_alias_id) return { error: '매출처 별칭이 없는 주문이라 선결제를 사용할 수 없습니다.' }
  const amount = Math.round(Number(String(rawAmount ?? '').replace(/,/g, '')))
  if (!Number.isFinite(amount) || amount <= 0) return { error: '사용 금액을 입력하세요.' }

  const vendorId = await vendorOfOrder(admin, order)
  const [bal, recv] = await Promise.all([
    prepayBalanceOf(admin, vendorId, order.customer_alias_id),
    loadReceivableMap(admin, [orderId]),
  ])
  const outstanding = recv?.get(orderId)?.outstanding ?? 0
  if (amount > outstanding) return { error: `사용 금액(${won(amount)}원)이 이 주문 미수(${won(outstanding)}원)보다 큽니다.` }
  if (amount > bal.balance) return { error: `사용 금액(${won(amount)}원)이 선결제 잔액(${won(bal.balance)}원)보다 큽니다.` }

  const today = kstToday()
  const note = memo?.trim() || null
  const { data: led, error: le } = await admin.from('erp_prepayments').insert({
    direction: 'customer', entry_type: 'deduction', alias_id: order.customer_alias_id,
    entry_date: today, amount, order_id: orderId,
    memo: [`주문 ${order.order_no ?? ''} 결제`, editor.employeeName, note].filter(Boolean).join(' · '),
  }).select('id').single()
  if (le || !led) return { error: `선결제 원장 기록 실패: ${le?.message ?? ''}` }

  const { error: me } = await admin.from('erp_payment_matches').insert({
    order_id: orderId, source_type: 'prepay', source_id: led.id, amount, paid_date: today,
    matched_by: 'manual', memo: ['선결제 사용', editor.employeeName, note].filter(Boolean).join(' · '),
  })
  if (me) {
    await admin.from('erp_prepayments').delete().eq('id', led.id)   // 반쪽 기록 방지
    return { error: /check|source_type/i.test(me.message)
      ? '514 마이그레이션(선결제 사용)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
      : `수금 기록 실패: ${me.message}` }
  }
  await writeEditLogs(admin, orderId, editor, [{ field: '선결제 사용', before: null, after: `${won(amount)}원${note ? ` (${note})` : ''}` }])
  return { ok: true, balance: bal.balance - amount, outstanding: outstanding - amount }
}

export async function releasePrepay(
  admin: SupabaseClient, orderId: string, matchId: string, editor: Editor,
): Promise<{ error: string } | { ok: true }> {
  const { data: m } = await admin.from('erp_payment_matches')
    .select('id, order_id, source_type, source_id, amount').eq('id', matchId).maybeSingle()
  if (!m || m.order_id !== orderId || m.source_type !== 'prepay') return { error: '선결제 사용 기록을 찾을 수 없습니다.' }
  const order = await loadOrder(admin, orderId)
  if (order?.canceled_at) return { error: '취소된 주문의 기록은 해제할 수 없습니다.' }
  const { error: de } = await admin.from('erp_payment_matches').delete().eq('id', matchId)
  if (de) return { error: `해제 실패: ${de.message}` }
  await admin.from('erp_prepayments').delete().eq('id', m.source_id as string).eq('entry_type', 'deduction')
  await writeEditLogs(admin, orderId, editor, [{ field: '선결제 사용 해제', before: `${won(Number(m.amount ?? 0))}원`, after: null }])
  return { ok: true }
}
