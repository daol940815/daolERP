import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/vendor-opening-balances?q=거래처명
//   q 있으면: 이름 검색(상위 50) + 현재 기초잔액
//   q 없으면: 기초잔액이 입력된 거래처 목록
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const q = new URL(req.url).searchParams.get('q')?.trim()

  const { data: openings, error: oe } = await admin
    .from('vendor_opening_balances')
    .select('vendor_id, amount, note, as_of_date')
  if (oe) return NextResponse.json({ error: oe.message }, { status: 500 })
  const openMap = new Map((openings ?? []).map(o => [o.vendor_id, o]))

  let vendors: { id: string; name: string; type: string | null }[] = []
  if (q) {
    const { data, error } = await admin
      .from('vendors')
      .select('id, name, type')
      .ilike('name', `%${q}%`)
      .order('name')
      .limit(50)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    vendors = data ?? []
  } else {
    const ids = Array.from(openMap.keys())
    if (ids.length) {
      const { data, error } = await admin.from('vendors').select('id, name, type').in('id', ids).order('name')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      vendors = data ?? []
    }
  }

  const rows = vendors.map(v => {
    const o = openMap.get(v.id)
    return { vendor_id: v.id, name: v.name, type: v.type, amount: o?.amount ?? 0, note: o?.note ?? null, has_value: !!o }
  })
  return NextResponse.json({ data: rows })
}

// PATCH /api/vendor-opening-balances { vendor_id, amount, note? }  (amount=0 → 삭제)
export async function PATCH(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { vendor_id?: string; amount?: number; note?: string | null }
  if (!body.vendor_id) return NextResponse.json({ error: 'vendor_id가 필요합니다.' }, { status: 400 })
  const amount = Math.trunc(Number(body.amount ?? 0))
  if (!Number.isFinite(amount)) return NextResponse.json({ error: '금액이 올바르지 않습니다.' }, { status: 400 })

  if (amount === 0) {
    const { error } = await admin.from('vendor_opening_balances').delete().eq('vendor_id', body.vendor_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: true })
  }

  const row: Record<string, unknown> = { vendor_id: body.vendor_id, amount }
  if (body.note !== undefined) row.note = body.note
  const { error } = await admin.from('vendor_opening_balances').upsert(row, { onConflict: 'vendor_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
