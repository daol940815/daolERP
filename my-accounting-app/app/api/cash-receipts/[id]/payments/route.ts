import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { addReceiptPayment, listReceiptPayments, loadReceiptCandidates, removeReceiptPayment } from '@/lib/cash-receipt-payments.server'

export const dynamic = 'force-dynamic'

// 현금영수증(매출 발행) ↔ 통장 입금 연결 (425)
// GET  /api/cash-receipts/:id/payments                 — 연결 목록
// GET  /api/cash-receipts/:id/payments?candidates=1[&from&to&q] — 입금 후보 (기본 ±7일 · 금액 ≥ 잔액, from/to/q 주면 직접 찾기)
// POST body { transactionId, amount }                  — 연결 추가
// DELETE body { paymentId }                            — 연결 해제
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const { id } = await params
  const sp = new URL(req.url).searchParams
  if (sp.get('candidates')) {
    const res = await loadReceiptCandidates(admin, id, { from: sp.get('from'), to: sp.get('to'), q: sp.get('q') })
    if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 })
    return NextResponse.json(res)
  }
  return NextResponse.json({ data: await listReceiptPayments(admin, id) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json().catch(() => null) as { transactionId?: string; amount?: number } | null
  if (!body?.transactionId || !body.amount) return NextResponse.json({ error: '입금 거래와 연결할 금액이 필요합니다.' }, { status: 400 })
  const r = await addReceiptPayment(admin, id, body.transactionId, Number(body.amount), 'manual')
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ data: await listReceiptPayments(admin, id) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { paymentId?: string }
  if (!body.paymentId) return NextResponse.json({ error: '해제할 연결이 필요합니다.' }, { status: 400 })
  const r = await removeReceiptPayment(admin, id, body.paymentId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ data: await listReceiptPayments(admin, id) })
}
