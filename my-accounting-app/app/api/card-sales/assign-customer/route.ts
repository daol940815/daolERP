import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// POST /api/card-sales/assign-customer — body: { cardNumber, vendorId }
// 사용자가 확정한 "카드번호 = 매출처" 연결을 적용한다:
//   ① 그 카드번호의 미연결 카드매출 전부에 매출처 태깅 (기존 태깅은 덮어쓰지 않음)
//   ② 거래처 card_numbers에 카드번호 학습 → 이후 업로드부터 자동 태깅 (import가 참조)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { cardNumber?: string; vendorId?: string }
  const cardNumber = body.cardNumber?.trim()
  const vendorId = body.vendorId
  if (!cardNumber || !vendorId) {
    return NextResponse.json({ error: 'cardNumber와 vendorId가 필요합니다.' }, { status: 400 })
  }

  const { data: vendor, error: vErr } = await admin
    .from('vendors').select('id, name, card_numbers').eq('id', vendorId).single()
  if (vErr || !vendor) return NextResponse.json({ error: '거래처를 찾을 수 없습니다.' }, { status: 404 })

  const { data: updated, error: uErr } = await admin
    .from('card_sales')
    .update({ vendor_id: vendorId })
    .eq('card_number', cardNumber)
    .is('vendor_id', null)
    .select('id')
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // 카드번호 학습 (중복 방지)
  const existing = (vendor.card_numbers as string[] | null) ?? []
  if (!existing.includes(cardNumber)) {
    await admin.from('vendors').update({ card_numbers: [...existing, cardNumber] }).eq('id', vendorId)
  }

  return NextResponse.json({ tagged: (updated ?? []).length, vendor_name: vendor.name })
}

// DELETE — body: { cardNumber, vendorId }: 연결 해제 (태깅 제거 + 학습 취소)
export async function DELETE(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { cardNumber?: string; vendorId?: string }
  const cardNumber = body.cardNumber?.trim()
  const vendorId = body.vendorId
  if (!cardNumber || !vendorId) {
    return NextResponse.json({ error: 'cardNumber와 vendorId가 필요합니다.' }, { status: 400 })
  }

  const { data: cleared, error } = await admin
    .from('card_sales')
    .update({ vendor_id: null })
    .eq('card_number', cardNumber)
    .eq('vendor_id', vendorId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: vendor } = await admin.from('vendors').select('card_numbers').eq('id', vendorId).single()
  const existing = (vendor?.card_numbers as string[] | null) ?? []
  if (existing.includes(cardNumber)) {
    await admin.from('vendors').update({ card_numbers: existing.filter(c => c !== cardNumber) }).eq('id', vendorId)
  }

  return NextResponse.json({ cleared: (cleared ?? []).length })
}
