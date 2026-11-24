import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { NOT_VOID_OR, CARD_SALE_VOID_STATUSES, isCardSaleVoided } from '@/lib/card-sale-status'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { loadCardSaleContext, syncCardSaleJournal } from '@/lib/journal/card-sales-posting'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 분개가 없는 카드매출 — 주로 공급가·세액 미기재 건(2026-11-12 이전 규칙은 전기하지 않았다).
// 카드 내역 › 카드매출 탭의 "분개 누락 동기화"가 쓴다.
//   GET  /api/card-sales/sync-journals → 건수 · 금액(그중 미기재 건수 · 금액)만
//   POST /api/card-sales/sync-journals → 전기(멱등). 매입사 인식 불가 · 합계 불일치 건은 검토 대상으로 남는다.
type Sale = { id: string; amount: number | null; supply_amount: number | null; tax_amount: number | null }

async function findUnposted(admin: ReturnType<typeof createAdminClient>) {
  const sales = await fetchAllRows<Sale>((f, t) =>
    admin.from('card_sales').select('id, amount, supply_amount, tax_amount').neq('amount', 0).or(NOT_VOID_OR).range(f, t))   // 중복해제는 전기 대상 아님 (2026-11-17)
  if ('error' in sales) return { error: sales.error }
  const posted = await fetchAllRows<{ source_id: string }>((f, t) =>
    admin.from('journal_entries').select('source_id').eq('source_type', 'card_sale').range(f, t))
  if ('error' in posted) return { error: posted.error }
  const has = new Set(posted.data.map(p => p.source_id))
  const list = sales.data.filter(s => !has.has(s.id))
  // 정산상태 중복해제(수금 없음)인데 전기돼 있는 건 — 규칙 도입(2026-11-17) 전 전기분. 동기화 때 전기 취소 대상
  const voidedPosted = await fetchAllRows<{ id: string; amount: number | null; settlement_status: string | null; processing_status: string | null }>((f, t) =>
    admin.from('card_sales').select('id, amount, settlement_status, processing_status').in('settlement_status', [...CARD_SALE_VOID_STATUSES]).range(f, t))
  const voided = 'error' in voidedPosted ? [] : voidedPosted.data.filter(s => has.has(s.id) && isCardSaleVoided(s))   // 입금완료 예외(2026-11-24)는 취소 대상 아님
  const isUnknown = (s: Sale) => !(s.supply_amount ?? 0) && !(s.tax_amount ?? 0)
  const unknown = list.filter(isUnknown)
  return {
    list,
    summary: {
      unposted: list.length,
      total: list.reduce((s, r) => s + (r.amount ?? 0), 0),
      unknown_vat: unknown.length,
      unknown_total: unknown.reduce((s, r) => s + (r.amount ?? 0), 0),
      voided_posted: voided.length,
      voided_total: voided.reduce((s, r) => s + (r.amount ?? 0), 0),
    },
    voided,
  }
}

export async function GET() {
  const admin = createAdminClient()
  const r = await findUnposted(admin)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json(r.summary)
}

export async function POST() {
  const admin = createAdminClient()
  const r = await findUnposted(admin)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  const ctx = await loadCardSaleContext(admin)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: 500 })
  let posted = 0
  const reasons = new Map<string, number>()
  // 중복해제 건의 기존 분개 취소 (syncCardSaleJournal 이 전기 거부 → unpost)
  let unposted = 0
  for (const sale of r.voided) {
    const jr = await syncCardSaleJournal(admin, sale.id, ctx)
    if ('error' in jr) unposted++
  }
  for (const sale of r.list) {
    const jr = await syncCardSaleJournal(admin, sale.id, ctx)
    if ('error' in jr) {
      const key = jr.error.replace(/".*"/, '"…"').replace(/\(.*\)/, '').trim()
      reasons.set(key, (reasons.get(key) ?? 0) + 1)
    } else posted++
  }
  return NextResponse.json({
    targets: r.list.length,
    posted,
    review: r.list.length - posted,
    voided_unposted: unposted,
    review_reasons: Array.from(reasons.entries()).map(([reason, count]) => ({ reason, count })),
  })
}
