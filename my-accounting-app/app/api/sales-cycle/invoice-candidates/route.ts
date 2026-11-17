import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { syncRecordsForOrders } from '@/lib/payment-records'
import { buildInvoiceLinkCandidates, isMissingOrderInvoiceTable } from '@/lib/order-invoice-match'
import { loadBillingFamily } from '@/lib/billing'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIGRATION_HINT = '067 마이그레이션(erp_order_invoices) 적용이 필요합니다. Supabase SQL 편집기에서 067_erp_order_invoices.sql을 실행해주세요.'

// GET /api/sales-cycle/invoice-candidates?vendorId=...
// 한 매출처의 주문 ↔ 계산서 연결 후보(1:1·합산·분할)를 계산해 내려준다. 추천만 — 확정은 POST.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendorId')
  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })

  const admin = createAdminClient()
  const result = await buildInvoiceLinkCandidates(admin, vendorId, sp.get('from'))
  if ('error' in result) {
    return NextResponse.json(
      { error: result.missingTable ? MIGRATION_HINT : result.error },
      { status: 500 },
    )
  }

  // 청구처 상태 — 다른 거래처 명의 계산서를 연결할 때 "청구처로 지정할까요?"를 물을 수 있는지 (2026-11-17)
  //   물을 수 있는 조건: 114 적용 · 이 매출처에 청구처가 없음 · 이 매출처가 다른 곳의 청구처가 아님 · 거래처 관리 수정 권한
  const [fam, me] = await Promise.all([loadBillingFamily(admin, vendorId), getCurrentUser()])
  const billing = {
    name: fam.billing?.name ?? null,
    can_ask: fam.available && !fam.billing && fam.children.length === 0 && !!me && can(me, 'customers', 'edit'),
  }

  return NextResponse.json({
    ...result,
    billing,
    summary: {
      open_orders: result.orders.length,
      available_invoices: result.invoices.length,
      groups: result.groups.length,
      coverable_amount: result.groups.reduce((s, g) => s + g.amount, 0),
    },
  })
}

// POST — body: { links: [{ orderId, taxInvoiceId, amount, issueDate }] }
// 사용자가 확정한 조합을 erp_order_invoices에 기록하고,
// 계산서에 이미 매칭된 입금이 있으면 주문 수금배분으로 이월한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as {
    links?: { orderId: string; taxInvoiceId: string; amount: number; issueDate: string }[]
  } | null
  const links = (body?.links ?? []).filter(l => l.orderId && l.taxInvoiceId && l.amount > 0)
  if (!links.length) return NextResponse.json({ error: '확정할 연결이 없습니다.' }, { status: 400 })

  // 서버 재검사 (2026-11-17) — 연결 창구가 계산서 확인 · 매출처 상세 · 주문 상세 3곳으로 늘어 동시에 연결할 수 있다.
  // 화면의 후보 계산을 믿지 않고, 저장 직전에 주문 · 계산서의 남은 금액을 다시 계산해 넘치면 거부한다.
  const blocked = await recheckLinks(admin, links)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })

  const rows = links.map(l => ({
    order_id: l.orderId,
    tax_invoice_id: l.taxInvoiceId,
    amount: l.amount,
    issue_date: l.issueDate.slice(0, 10),
    matched_by: 'manual',
    memo: '계산서연결 확정',
  }))
  const { error } = await admin.from('erp_order_invoices').insert(rows)
  if (error) {
    return NextResponse.json(
      { error: isMissingOrderInvoiceTable(error.message) ? MIGRATION_HINT : error.message },
      { status: 500 },
    )
  }

  const propagated = await propagatePayments(admin, links)

  return NextResponse.json({
    linked: rows.length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
    propagated,
  })
}

// ── 저장 전 재검사 ─────────────────────────────────────────────
// 거부 사유를 한 문장으로 돌려준다(없으면 null). 검사: 주문 존재 · 취소 아님 / 매출 계산서(양수) / 같은 주문-계산서 중복 /
// 주문 남은 금액(순매출 − 기연결) · 계산서 남은 금액(합계 − 기배분) 초과.
async function recheckLinks(
  admin: ReturnType<typeof createAdminClient>,
  links: { orderId: string; taxInvoiceId: string; amount: number }[],
): Promise<string | null> {
  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
  const orderIds = Array.from(new Set(links.map(l => l.orderId)))
  const invoiceIds = Array.from(new Set(links.map(l => l.taxInvoiceId)))
  const seen = new Set<string>()
  for (const l of links) {
    if (!Number.isInteger(l.amount)) return '연결 금액이 올바르지 않습니다.'
    const k = `${l.orderId}:${l.taxInvoiceId}`
    if (seen.has(k)) return '같은 주문과 계산서가 두 번 들어 있습니다.'
    seen.add(k)
  }
  const chunk = <T,>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

  const orders = new Map<string, { order_no: string | null; total: number; canceled: boolean }>()
  const excluded = new Map<string, number>()
  const invoices = new Map<string, { total: number; direction: string; issue_date: string }>()
  const linkedByOrder = new Map<string, number>()
  const linkedByInvoice = new Map<string, number>()
  const existing = new Set<string>()
  for (const ch of chunk(orderIds)) {
    const [o, it, ex] = await Promise.all([
      admin.from('erp_orders').select('id, order_no, total_amount, canceled_at').in('id', ch),
      admin.from('erp_order_items').select('order_id, line_total').in('order_id', ch).or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true'),
      admin.from('erp_order_invoices').select('order_id, tax_invoice_id, amount').in('order_id', ch),
    ])
    if (o.error || it.error || ex.error) return (o.error ?? it.error ?? ex.error)!.message
    for (const r of o.data ?? []) orders.set(r.id as string, { order_no: r.order_no as string | null, total: Number(r.total_amount ?? 0), canceled: !!r.canceled_at })
    for (const r of it.data ?? []) excluded.set(r.order_id as string, (excluded.get(r.order_id as string) ?? 0) + Number(r.line_total ?? 0))
    for (const r of ex.data ?? []) {
      linkedByOrder.set(r.order_id as string, (linkedByOrder.get(r.order_id as string) ?? 0) + Number(r.amount ?? 0))
      existing.add(`${r.order_id}:${r.tax_invoice_id}`)
    }
  }
  for (const ch of chunk(invoiceIds)) {
    const [v, ex] = await Promise.all([
      admin.from('tax_invoices').select('id, total_amount, direction, issue_date').in('id', ch),
      admin.from('erp_order_invoices').select('tax_invoice_id, amount').in('tax_invoice_id', ch),
    ])
    if (v.error || ex.error) return (v.error ?? ex.error)!.message
    for (const r of v.data ?? []) invoices.set(r.id as string, { total: Number(r.total_amount ?? 0), direction: r.direction as string, issue_date: String(r.issue_date).slice(0, 10) })
    for (const r of ex.data ?? []) linkedByInvoice.set(r.tax_invoice_id as string, (linkedByInvoice.get(r.tax_invoice_id as string) ?? 0) + Number(r.amount ?? 0))
  }

  const addOrder = new Map<string, number>(), addInvoice = new Map<string, number>()
  for (const l of links) {
    const o = orders.get(l.orderId), v = invoices.get(l.taxInvoiceId)
    if (!o) return '주문을 찾을 수 없습니다. 화면을 새로 고친 뒤 다시 시도하세요.'
    if (o.canceled) return `취소된 주문(${o.order_no ?? ''})에는 계산서를 연결할 수 없습니다.`
    if (!v) return '계산서를 찾을 수 없습니다. 화면을 새로 고친 뒤 다시 시도하세요.'
    if (v.direction !== 'sales' || v.total <= 0) return '매출 계산서(양수)만 주문에 연결할 수 있습니다.'
    if (existing.has(`${l.orderId}:${l.taxInvoiceId}`)) return `주문 ${o.order_no ?? ''}에 이미 연결된 계산서입니다. 다른 사람이 먼저 연결했을 수 있으니 화면을 새로 고쳐 주세요.`
    addOrder.set(l.orderId, (addOrder.get(l.orderId) ?? 0) + l.amount)
    addInvoice.set(l.taxInvoiceId, (addInvoice.get(l.taxInvoiceId) ?? 0) + l.amount)
  }
  for (const [id, add] of Array.from(addOrder)) {
    const o = orders.get(id)!
    const left = o.total - (excluded.get(id) ?? 0) - (linkedByOrder.get(id) ?? 0)
    if (add > left) return `주문 ${o.order_no ?? ''}의 계산서 미연결 금액은 ${won(Math.max(0, left))}입니다. ${won(add)}은 연결할 수 없습니다. (다른 사람이 먼저 연결했을 수 있습니다 — 화면을 새로 고쳐 주세요)`
  }
  for (const [id, add] of Array.from(addInvoice)) {
    const v = invoices.get(id)!
    const left = v.total - (linkedByInvoice.get(id) ?? 0)
    if (add > left) return `계산서(${v.issue_date})의 남은 금액은 ${won(Math.max(0, left))}입니다. ${won(add)}은 연결할 수 없습니다. (이미 다른 주문에 연결됐을 수 있습니다 — 화면을 새로 고쳐 주세요)`
  }
  return null
}

// ── 수금 이월 ──────────────────────────────────────────────────
// 주문-계산서 연결이 확정되면, 그 계산서에 매칭된 입금(tax_invoice_payments)을
// 찾아 주문 수금배분(erp_payment_matches)을 자동 생성한다.
// 이월 금액은 안전하게 4중 상한: 연결 금액 / 계산서별 결제 금액 /
// 입금의 미배분 잔액 / 주문의 수금 미배분 잔액 — 과배분이 원천적으로 불가능하다.
async function propagatePayments(
  admin: ReturnType<typeof createAdminClient>,
  links: { orderId: string; taxInvoiceId: string; amount: number }[],
): Promise<{ count: number; amount: number }> {
  const result = { count: 0, amount: 0 }
  try {
    // 주문별 수금 여유 = 순매출 - 기존 수금배분
    const orderIds = Array.from(new Set(links.map(l => l.orderId)))
    const orderPayCap = new Map<string, number>()
    for (const oid of orderIds) {
      const { data: ord } = await admin.from('erp_orders').select('total_amount').eq('id', oid).single()
      const { data: items } = await admin.from('erp_order_items')
        .select('line_total')
        .eq('order_id', oid)
        .or('is_canceled.eq.true,is_vip.eq.true,is_prepayment.eq.true')
      const net = (ord?.total_amount ?? 0) - (items ?? []).reduce((s, r) => s + ((r.line_total as number) ?? 0), 0)
      const { data: alloc } = await admin.from('erp_payment_matches').select('amount').eq('order_id', oid)
      orderPayCap.set(oid, net - (alloc ?? []).reduce((s, r) => s + (r.amount as number), 0))
    }

    for (const l of links) {
      let remain = l.amount
      let cap = orderPayCap.get(l.orderId) ?? 0
      if (cap <= 0) continue

      const { data: pays } = await admin.from('tax_invoice_payments')
        .select('amount, transaction:transactions(id, tx_date, amount_in)')
        .eq('tax_invoice_id', l.taxInvoiceId)
        .gt('amount', 0)
        .order('created_at', { ascending: true })
      for (const p of pays ?? []) {
        if (remain <= 0 || cap <= 0) break
        const tx = p.transaction as unknown as { id: string; tx_date: string; amount_in: number | null } | null
        if (!tx || !(tx.amount_in && tx.amount_in > 0)) continue
        // 입금의 미배분 잔액 (다른 주문에 이미 배분된 금액 차감)
        const { data: srcAlloc } = await admin.from('erp_payment_matches')
          .select('amount')
          .eq('source_type', 'bank')
          .eq('source_id', tx.id)
        const depCap = tx.amount_in - (srcAlloc ?? []).reduce((s, r) => s + (r.amount as number), 0)
        const amt = Math.min(remain, cap, p.amount as number, depCap)
        if (amt <= 0) continue
        const { error } = await admin.from('erp_payment_matches').insert({
          order_id: l.orderId,
          source_type: 'bank',
          source_id: tx.id,
          amount: amt,
          paid_date: tx.tx_date,
          matched_by: 'auto',
          memo: '계산서 매칭 이월',
        })
        if (error) continue
        remain -= amt
        cap -= amt
        result.count++
        result.amount += amt
      }
      orderPayCap.set(l.orderId, cap)
    }
    // 결제 기록(1300)과 동기화 — 계산서 발행 기록이 이월된 입금으로 채워지면 자동 확정 (2026-11-16)
    if (result.count > 0) {
      const me = await getCurrentUser()
      await syncRecordsForOrders(admin, orderIds, { employeeId: me?.employeeId ?? null, employeeName: me?.employeeName ?? null }, '계산서 매칭 이월')
    }
  } catch {
    // 이월 실패는 연결 자체에 영향 주지 않는다 (수금후보로 언제든 보완 가능)
  }
  return result
}
