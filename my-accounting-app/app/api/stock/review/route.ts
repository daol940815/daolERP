import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { syncOrderStock } from '@/lib/stock'
import { resolveReason, type ReasonKind } from '@/lib/payment-reasons'
import { adjustFromStocktake, confirmNewPurchase, convertToStockOut, loadReview } from '@/lib/stock-review'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET  /api/stock/review — 재고 관리 › 확인 필요 탭 목록 (1401)
// POST /api/stock/review { action, ... } — 처리 (주문 · 발주 수정 권한 — 미들웨어가 POST를 수정으로 검사)
//   to_out       { item_id, reason }      재고 출고로 바꾸기 (원 행 취소 + 새 재고 출고 행, 주문 변경 이력)
//   confirm_new  { item_id, reason? }     맞음(실제 새로 매입) — 다시 띄우지 않음
//   reallocate   { order_id }             재고 원가 미배정 행 다시 배정
//   adjust       { stocktake_id, reason } 실사 차이 조정 기록
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const r = await loadReview(createAdminClient())
  if ('error' in r) return NextResponse.json({ error: r.error, migration1400: r.migration ? false : undefined }, { status: r.migration ? 200 : 500 })
  return NextResponse.json({ ...r, can_edit: can(me, 'orders', 'edit') })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const b = (await req.json().catch(() => ({}))) as { action?: string; item_id?: string; order_id?: string; stocktake_id?: string; reason?: unknown }
  const editor = { employeeId: me.employeeId, employeeName: me.employeeName }
  // 사유는 항목 선택(lib/payment-reasons.ts) — 재고 출고로 바꾸기 · 맞음 · 조정 모두 필수
  const kind: Record<string, ReasonKind> = { to_out: 'stock_out', confirm_new: 'stock_confirm', adjust: 'stock_adjust' }
  let reason = ''
  if (b.action && kind[b.action]) {
    const r = resolveReason(kind[b.action], b.reason)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    reason = r.text
  }

  if (b.action === 'to_out' && b.item_id) {
    const r = await convertToStockOut(admin, b.item_id, reason, editor)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status ?? 500 })
    return NextResponse.json({ ok: true, warning: r.warning })
  }
  if (b.action === 'confirm_new' && b.item_id) {
    const err = await confirmNewPurchase(admin, b.item_id, reason, editor)
    return err ? NextResponse.json({ error: err }, { status: 409 }) : NextResponse.json({ ok: true })
  }
  if (b.action === 'reallocate' && b.order_id) {
    const warn = await syncOrderStock(admin, b.order_id)
    return NextResponse.json({ ok: true, warning: warn })
  }
  if (b.action === 'adjust' && b.stocktake_id) {
    const err = await adjustFromStocktake(admin, b.stocktake_id, reason, editor)
    return err ? NextResponse.json({ error: err }, { status: 409 }) : NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: '알 수 없는 처리입니다.' }, { status: 400 })
}
