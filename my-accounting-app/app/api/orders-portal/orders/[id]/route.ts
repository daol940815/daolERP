import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUser, type CurrentUser } from '@/lib/user-role'
import {
  validateOrderInput, applyOrderEdit, resolveDisplayNames, loadOrderSnapshot,
  cancelOrder, canCancelReissue, kstToday, kstDateOf,
} from '@/lib/orders-portal'
import { recordWorkLog, orderContent } from '@/lib/work-log'
import { loadReceivableMap, collectStatusFrom } from '@/lib/orders-portal-list'
import { can } from '@/lib/permissions'
import { prepayBalanceOf, prepayUsedOf, vendorOfOrder } from '@/lib/prepay'

export const dynamic = 'force-dynamic'

// 주문 상세 / 당일 직접 수정 / 취소 (홈택스 방식 — 2026-08-25 확정)
//  - 당일(KST, created_at 기준) 입력자 본인·manager/admin: 직접 수정 (변경 로그 기록)
//  - 익일 이후: 직접 수정 불가 → 취소·재등록 (승인 없음, 이력 보존)
//  - 삭제(DELETE)는 물리 삭제 폐지 → 취소 처리 (집계 제외로 상계)
type OrderRow = Record<string, unknown>

function editability(order: OrderRow, me: CurrentUser) {
  if (order.source !== 'direct' || order.canceled_at) return { canEdit: false }
  if (me.role === 'manager' || me.role === 'admin') return { canEdit: true }
  const isOwner = !!me.employeeId && order.created_by_employee_id === me.employeeId
  const isToday = kstDateOf(String(order.created_at)) === kstToday()
  return { canEdit: isOwner && isToday }
}

// 결제 내역 (2026-11-04 사용자 확정 — 1단계 표기만): 수금 매칭·계산서 연결을
// 읽기 전용으로 모아 내려준다. 주문 상세는 표기만 하고 회계 화면 링크·조작은 없다.
// 연결 자체는 회계·수금 쪽(erp_payment_matches·erp_order_invoices·tax_invoice_payments)이 원천.
async function loadPayments(admin: SupabaseClient, orderId: string) {
  const empty = { matches: [] as unknown[], invoices: [] as unknown[] }
  const { data: matchRows, error: mErr } = await admin.from('erp_payment_matches')
    .select('id, source_type, source_id, amount, paid_date, matched_by, memo')
    .eq('order_id', orderId).order('paid_date')
  if (mErr) return empty   // 미적용·권한 등 — 섹션만 비워 보낸다
  const matches = matchRows ?? []

  // 출처 요약 — "카드매출 1,000,000원 중 300,000원 분배" 표시용
  const ids = (t: string) => matches.filter(m => m.source_type === t).map(m => m.source_id as string)
  const srcInfo = new Map<string, { label: string; total: number }>()
  const bankIds = ids('bank'), cardIds = ids('card'), cashIds = ids('cash')
  for (const m of matches.filter(x => x.source_type === 'prepay')) {
    srcInfo.set(m.source_id as string, { label: '선결제 잔액에서 사용', total: Number(m.amount ?? 0) })
  }
  if (bankIds.length) {
    const { data } = await admin.from('transactions')
      .select('id, counterparty_name, description, amount_in').in('id', bankIds)
    for (const t of data ?? []) {
      const who = String(t.counterparty_name || t.description || '').slice(0, 20)
      srcInfo.set(t.id as string, { label: who ? `통장 입금 (${who})` : '통장 입금', total: Number(t.amount_in ?? 0) })
    }
  }
  if (cardIds.length) {
    // 원거래 금액은 회계 쪽 매칭(lib/erp-order-collect.ts)과 같은 순액 = 승인 − 같은 승인번호의 취소
    const { data } = await admin.from('card_sales')
      .select('id, acquirer, card_number, amount, approval_number').in('id', cardIds)
    const nos = (data ?? []).map(c => c.approval_number as string).filter(Boolean)
    const cancel = new Map<string, number>()
    if (nos.length) {
      const { data: cs } = await admin.from('card_sales').select('approval_number, amount')
        .eq('transaction_type', 'cancel').in('approval_number', nos)
      for (const x of cs ?? []) {
        cancel.set(x.approval_number as string, (cancel.get(x.approval_number as string) ?? 0) + Math.abs(Number(x.amount ?? 0)))
      }
    }
    for (const c of data ?? []) {
      const tail = c.card_number ? String(c.card_number).replace(/\D/g, '').slice(-4) : ''
      const desc = [c.acquirer, tail && `끝 ${tail}`].filter(Boolean).join(' · ')
      srcInfo.set(c.id as string, {
        label: `카드 결제${desc ? ` (${desc})` : ''}`,
        total: Math.abs(Number(c.amount ?? 0)) - (cancel.get(c.approval_number as string) ?? 0),
      })
    }
  }
  if (cashIds.length) {
    const { data } = await admin.from('cash_receipts').select('id, amount').in('id', cashIds)
    for (const c of data ?? []) srcInfo.set(c.id as string, { label: '현금영수증', total: Number(c.amount ?? 0) })
  }

  // 계산서 연결 + 그 계산서의 통장 입금 상태 (tax_invoice_payments)
  const { data: invLinks } = await admin.from('erp_order_invoices')
    .select('id, tax_invoice_id, amount, issue_date')
    .eq('order_id', orderId).order('issue_date')
  const links = invLinks ?? []
  const invIds = Array.from(new Set(links.map(l => l.tax_invoice_id as string)))
  const invTotal = new Map<string, number>()
  const invPaid = new Map<string, { sum: number; last: string | null }>()
  if (invIds.length) {
    const [invRes, payRes] = await Promise.all([
      admin.from('tax_invoices').select('id, total_amount').in('id', invIds),
      admin.from('tax_invoice_payments')
        .select('tax_invoice_id, amount, transaction:transactions(tx_date)').in('tax_invoice_id', invIds),
    ])
    for (const v of invRes.data ?? []) invTotal.set(v.id as string, Number(v.total_amount ?? 0))
    for (const p of payRes.data ?? []) {
      const key = p.tax_invoice_id as string
      const cur = invPaid.get(key) ?? { sum: 0, last: null }
      cur.sum += Number(p.amount ?? 0)
      const d = (p.transaction as unknown as { tx_date: string } | null)?.tx_date ?? null
      if (d && (!cur.last || d > cur.last)) cur.last = d
      invPaid.set(key, cur)
    }
  }

  return {
    matches: matches.map(m => ({
      id: m.id, source_type: m.source_type, amount: m.amount, paid_date: m.paid_date,
      matched_by: m.matched_by, memo: m.memo,
      source: srcInfo.get(m.source_id as string) ?? null,
    })),
    invoices: links.map(l => ({
      id: l.id, amount: l.amount, issue_date: l.issue_date,
      invoice_total: invTotal.get(l.tax_invoice_id as string) ?? null,
      paid_sum: invPaid.get(l.tax_invoice_id as string)?.sum ?? 0,
      paid_last_date: invPaid.get(l.tax_invoice_id as string)?.last ?? null,
    })),
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  // 변경 로그 (511 미적용이면 빈 목록) + 재등록 링크 주문번호
  const { data: logs } = await admin.from('erp_order_edit_logs')
    .select('id, employee_name, field_label, before_text, after_text, created_at')
    .eq('order_id', params.id).order('created_at', { ascending: false })
  const linkIds = [snap.order.reissued_to_order_id, snap.order.reissued_from_order_id]
    .filter(Boolean) as string[]
  const linkNos = new Map<string, string>()
  if (linkIds.length) {
    const { data } = await admin.from('erp_orders').select('id, order_no').in('id', linkIds)
    for (const o of data ?? []) linkNos.set(o.id as string, (o.order_no as string) ?? '')
  }

  // 과거 수정요청 이력 (제도 폐지 — 남은 기록 열람용)
  const { data: requests } = await admin
    .from('erp_order_change_requests')
    .select('id, request_type, reason, status, decision_memo, created_at, decided_at')
    .eq('order_id', params.id)
    .order('created_at', { ascending: false })

  // 비용 품목(품목 마스터 '비용 품목' 체크) 표시 — 배송지 판정에서 제외 (2026-11-05)
  const pids = Array.from(new Set((snap.items as Record<string, unknown>[]).map(it => it.product_id).filter(Boolean))) as string[]
  const costIds = new Set<string>()
  if (pids.length) {
    const { data, error } = await admin.from('erp_products').select('id, is_shipping').in('id', pids)
    if (!error) for (const p of data ?? []) if (p.is_shipping) costIds.add(p.id as string)
  }
  const items = (snap.items as Record<string, unknown>[]).map(it => ({ ...it, is_cost: costIds.has(it.product_id as string) }))

  const edit = editability(snap.order, me)
  const prepayVendor = await vendorOfOrder(admin, snap.order)
  const [payments, recvMap, prepayBal] = await Promise.all([
    loadPayments(admin, params.id),
    loadReceivableMap(admin, [params.id]),
    prepayBalanceOf(admin, prepayVendor, (snap.order.customer_alias_id as string | null) ?? null),
  ])
  // 표준 미수(매칭 반영) — erp_orders.outstanding_amount는 매칭 전 원본값이라 표시에 쓰지 않는다
  const recv = recvMap?.get(params.id)
  const receivable = snap.order.canceled_at
    ? { net_sales: 0, collected: 0, outstanding: 0, collect_status: String(snap.order.collect_status ?? '') }
    : recv
      ? {
          net_sales: recv.net_sales,
          collected: Math.max(0, recv.net_sales - recv.outstanding),
          outstanding: recv.outstanding,
          collect_status: collectStatusFrom(snap.order.collect_status as string | null, recv),
        }
      : null
  return NextResponse.json({
    order: snap.order,
    items,
    payments,
    receivable,
    // 선결제 사용 (514): 잔액 · 사용 가능 여부 (주문 수정 권한 + direct + 미취소)
    prepay: {
      balance: prepayBal.balance, deposit: prepayBal.deposit, deduction: prepayBal.deduction,
      can_use: can(me, 'orders', 'edit') && snap.order.source === 'direct' && !snap.order.canceled_at,
    },
    change_requests: requests ?? [],
    edit_logs: logs ?? [],
    can_edit: edit.canEdit,
    // 취소·재등록: 입력자 본인 + manager/admin (2026-08-25 제한 확정 — 승인은 없음)
    can_reissue: canCancelReissue(snap.order, me),
    canceled: !!snap.order.canceled_at,
    reissued_to_no: snap.order.reissued_to_order_id
      ? linkNos.get(snap.order.reissued_to_order_id as string) ?? null : null,
    reissued_from_no: snap.order.reissued_from_order_id
      ? linkNos.get(snap.order.reissued_from_order_id as string) ?? null : null,
    role: me.role,   // 매입가·마진은 전 직원 공개로 전환 (2026-08-13) — role은 참고용
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  if (snap.order.source !== 'direct') {
    return NextResponse.json({ error: '업로드 주문은 수정할 수 없습니다. (원본 보존)' }, { status: 403 })
  }
  if (snap.order.canceled_at) {
    return NextResponse.json({ error: '취소된 주문입니다. 재등록 주문에서 수정해주세요.' }, { status: 403 })
  }
  const edit = editability(snap.order, me)
  if (!edit.canEdit) {
    return NextResponse.json({
      error: '입력 당일이 지난 주문은 직접 수정 대신 취소·재등록으로 진행해주세요.',
    }, { status: 403 })
  }

  const parsed = validateOrderInput(await req.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const names = await resolveDisplayNames(admin, parsed.input)
  if (names.error) return NextResponse.json({ error: names.error }, { status: 400 })

  const result = await applyOrderEdit(admin, params.id, parsed.input, {
    managerName: names.managerName,
    counselorName: names.counselorName,
  }, { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    action: '주문수정',
    content: orderContent({
      customer: [snap.order.bank_name, snap.order.branch_name].filter(Boolean).join(' '),
      orderNo: (snap.order.order_no as string) ?? null,
      itemCount: parsed.input.items.length,
    }, '주문서 수정'),
    refType: 'order',
    refId: params.id,
  })
  // 선결제 사용분이 수정 후 주문 금액(순매출)보다 크면 경고 — 사용분은 그대로 유지
  let warning = result.warning
  const used = await prepayUsedOf(admin, params.id)
  if (used > 0) {
    const net = (await loadReceivableMap(admin, [params.id]))?.get(params.id)?.net_sales ?? 0
    if (used > net) {
      warning = [warning, `선결제 사용(${used.toLocaleString('ko-KR')}원)이 주문 금액(${net.toLocaleString('ko-KR')}원)보다 큽니다 — 결제 내역에서 해제 후 다시 사용하세요.`]
        .filter(Boolean).join(' / ')
    }
  }
  return NextResponse.json({ ok: true, warning })
}

// 주문 취소 (삭제 대체) — 물리 삭제 없이 취소 처리, 원본·이력 보존
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  if (snap.order.source !== 'direct') {
    return NextResponse.json({ error: '업로드 주문은 취소할 수 없습니다. (원본 보존)' }, { status: 403 })
  }
  if (snap.order.canceled_at) {
    return NextResponse.json({ error: '이미 취소된 주문입니다.' }, { status: 400 })
  }
  if (!canCancelReissue(snap.order, me)) {
    return NextResponse.json({ error: '본인이 입력한 주문만 취소할 수 있습니다. (관리자 제외)' }, { status: 403 })
  }

  // 수금 매칭·계산서 연결이 있으면 결제가 취소 주문에 묶인다 — 취소·재등록(연결 승계)으로 안내
  const [{ count: matchCnt }, { count: invCnt }] = await Promise.all([
    admin.from('erp_payment_matches').select('id', { count: 'exact', head: true }).eq('order_id', params.id),
    admin.from('erp_order_invoices').select('id', { count: 'exact', head: true }).eq('order_id', params.id),
  ])
  if ((matchCnt ?? 0) > 0 || (invCnt ?? 0) > 0) {
    return NextResponse.json({
      error: '수금 매칭(선결제 사용 포함) 또는 계산서가 연결된 주문은 단순 취소할 수 없습니다. '
        + '내용을 바꾸려면 취소·재등록(연결이 새 주문으로 넘어감)을, 주문 자체를 없애려면 선결제 사용은 결제 내역에서 해제하고 '
        + '통장·카드 매칭·계산서 연결은 회계·재무 담당자에게 해제를 먼저 요청해주세요.',
    }, { status: 409 })
  }

  const reason = new URL(req.url).searchParams.get('reason')
  const err = await cancelOrder(admin, params.id, {
    employeeId: me.employeeId, employeeName: me.employeeName,
  }, reason || null)
  if (err) return NextResponse.json({ error: err }, { status: 500 })

  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    // erp_work_logs.action CHECK(700 트랙) 범위 내에서 기재 — 내용으로 취소를 구분
    action: '주문수정',
    content: orderContent({
      customer: [snap.order.bank_name, snap.order.branch_name].filter(Boolean).join(' '),
      orderNo: (snap.order.order_no as string) ?? null,
      itemCount: snap.items.length,
    }, reason ? `주문 취소 (${reason})` : '주문 취소'),
    refType: 'order',
    refId: params.id,
  })
  return NextResponse.json({ ok: true })
}
