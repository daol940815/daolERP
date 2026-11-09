import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { ROSTER_BUCKET, linkItem, type RosterItemCandidate } from '@/lib/delivery-roster'
import { rosterCandidates } from '@/lib/delivery-roster-server'

export const dynamic = 'force-dynamic'

// 명단 행 편집 (패널 저장) / 명단 삭제
// PATCH { rows: [{ id?, seq, recipient_name, phone, zip, addr1, addr2, item_name_raw, item_name|null, quantity, memo }], deleted: [id] }
//   item_name이 후보 품목명과 같으면 연결(product_id·item_code 채움), 비우면 미연결.
// DELETE → 명단과 행 전부 삭제 (원본 파일 포함)

type Row = Record<string, unknown>
const t = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const { data: roster } = await admin.from('erp_delivery_rosters').select('*').eq('id', params.id).maybeSingle()
  if (!roster) return NextResponse.json({ error: '명단을 찾을 수 없습니다.' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { rows?: Row[]; deleted?: string[]; order_id?: string | null }
  const cands: RosterItemCandidate[] = await rosterCandidates(admin, {
    consultationId: roster.consultation_id as string | null, orderId: roster.order_id as string | null,
  })
  const byName = new Map(cands.map(c => [c.item_name, c]))

  if (body.deleted?.length) {
    const { error } = await admin.from('erp_delivery_roster_rows').delete().in('id', body.deleted).eq('roster_id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const upserts = (body.rows ?? []).map((r, i) => {
    // 연결: 화면에서 고른 품목명 우선, 없으면 적힌 상품명으로 정확 일치 재시도
    const picked = t(r.item_name) ? byName.get(String(r.item_name).trim()) ?? null : null
    const auto = picked ?? linkItem(t(r.item_name_raw), cands)
    const qty = Number(r.quantity)
    return {
      ...(t(r.id) ? { id: String(r.id) } : {}),
      roster_id: params.id,
      seq: Number(r.seq) || i + 1,
      recipient_name: t(r.recipient_name), phone: t(r.phone), zip: t(r.zip),
      addr1: t(r.addr1), addr2: t(r.addr2),
      item_name_raw: t(r.item_name_raw) ?? (picked?.item_name ?? null),
      product_id: auto?.product_id ?? null, item_code: auto?.item_code ?? null, item_name: auto?.item_name ?? null,
      quantity: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
      memo: t(r.memo),
      // 새 행의 주문 연결: 주문 명단이면 그 주문, 상담 명단이면 화면이 보낸 order_id(주문 화면에서 추가 시)
      ...(t(r.id) ? {} : { order_id: (roster.order_id as string | null) ?? body.order_id ?? null }),
    }
  })
  if (upserts.length) {
    const { error } = await admin.from('erp_delivery_roster_rows').upsert(upserts, { onConflict: 'id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  await admin.from('erp_delivery_rosters').update({ updated_at: new Date().toISOString() }).eq('id', params.id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const { data: roster } = await admin.from('erp_delivery_rosters').select('id, storage_path').eq('id', params.id).maybeSingle()
  if (!roster) return NextResponse.json({ error: '명단을 찾을 수 없습니다.' }, { status: 404 })
  if (roster.storage_path) await admin.storage.from(ROSTER_BUCKET).remove([roster.storage_path as string])
  const { error } = await admin.from('erp_delivery_rosters').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
