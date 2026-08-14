import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPurchaseHubDetail } from '@/lib/purchase-hub'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/purchase-hub/[vendorId]?from=&to=  — 매입처 360° 상세 번들
export async function GET(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildPurchaseHubDetail(admin, params.vendorId, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}

// PATCH — 활동 메모(vendors.note) 저장 또는 미결제금 기초원장 입력
// body: { note } | { opening: { amount, as_of_date, note? } } | { opening: null } (기초원장 삭제)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    note?: string | null
    email?: string | null
    purchase_kind?: string
    opening?: { amount?: number; as_of_date?: string; note?: string | null } | null
  }

  // 매입처 구분 (602) — partner=정기 거래 매입처 / online=온라인 구매처
  if ('purchase_kind' in body) {
    const kind = body.purchase_kind
    if (kind !== 'partner' && kind !== 'online') {
      return NextResponse.json({ error: "purchase_kind는 'partner' 또는 'online'이어야 합니다." }, { status: 400 })
    }
    const { error } = await admin.from('vendors').update({ purchase_kind: kind }).eq('id', params.vendorId)
    if (error) {
      return NextResponse.json(
        { error: `${error.message} — 602 마이그레이션(vendors.purchase_kind) 적용이 필요합니다.` },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true })
  }

  // 발주 이메일 (vendors.email) — 원가표 적재(508) 누락분을 여기서 보완
  if ('email' in body) {
    const email = body.email?.trim() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 })
    }
    const { error } = await admin.from('vendors').update({ email }).eq('id', params.vendorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if ('note' in body) {
    const { error } = await admin.from('vendors')
      .update({ note: body.note?.trim() || null })
      .eq('id', params.vendorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if ('opening' in body) {
    if (body.opening === null) {
      const { error } = await admin.from('purchase_opening_balances')
        .delete().eq('vendor_id', params.vendorId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    const amount = Math.round(Number(body.opening?.amount ?? NaN))
    const asOf = String(body.opening?.as_of_date ?? '')
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: '기초잔액은 0 이상의 숫자여야 합니다.' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json({ error: '기준일(as_of_date)이 필요합니다.' }, { status: 400 })
    }
    const { error } = await admin.from('purchase_opening_balances')
      .upsert({
        vendor_id: params.vendorId,
        amount,
        as_of_date: asOf,
        note: body.opening?.note?.trim() || null,
      }, { onConflict: 'vendor_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'note · email · purchase_kind · opening 중 하나가 필요합니다.' }, { status: 400 })
}
