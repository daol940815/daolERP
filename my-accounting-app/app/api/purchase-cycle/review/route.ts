import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// 매입 사이클 "확인" 기록 (설계 §5 — 잠금 아님)
// POST: 확인 시점에 화면에서 본 세 축 금액을 스냅샷으로 남긴다.
//       이후 금액이 바뀌면 조회 측이 자동으로 "재검토 필요"를 표시한다.
// GET ?vendorId=&month=&status= : 확인 이력 (무엇이 바뀌었는지 비교용)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    vendorId?: string; month?: string; status?: string
    erp?: number; invoice?: number; paid?: number
    reviewedBy?: string; note?: string
  }
  if (!body.vendorId || !body.month || !body.status) {
    return NextResponse.json({ error: 'vendorId, month, status가 필요합니다.' }, { status: 400 })
  }

  const { error } = await admin.from('purchase_cycle_reviews').insert({
    vendor_id: body.vendorId,
    month: body.month,
    status: body.status,
    reviewed_by: body.reviewedBy ?? null,
    note: body.note ?? null,
    snapshot_erp: Math.round(body.erp ?? 0),
    snapshot_invoice: Math.round(body.invoice ?? 0),
    snapshot_paid: Math.round(body.paid ?? 0),
  })
  if (error) {
    return NextResponse.json(
      { error: `확인 기록 실패: ${error.message} — 061 마이그레이션(purchase_cycle_reviews) 적용이 필요합니다.` },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendorId')
  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })

  let query = admin
    .from('purchase_cycle_reviews')
    .select('id, month, status, reviewed_at, reviewed_by, note, snapshot_erp, snapshot_invoice, snapshot_paid')
    .eq('vendor_id', vendorId)
    .order('reviewed_at', { ascending: false })
    .limit(200)
  const month = sp.get('month')
  const status = sp.get('status')
  if (month) query = query.eq('month', month)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ history: data ?? [] })
}
