import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// 거래처 담당자(인물 + 배정)
// GET /api/vendor-hub/contacts?q=이름     → 동일 인물 후보 검색(배정 이력 포함)
// POST body.action:
//   assign_new  { vendor_id, name, phone?, email?, title?, role_memo?, is_representative? }
//               인물 신규 등록 + 배정. 같은 이름 인물이 있으면 후보를 반환하고 보류
//               (force=true면 무조건 신규 인물로 진행)
//   assign      { vendor_id, contact_id, title?, role_memo?, is_representative? }
//               기존 인물 배정 (이동 처리: end_previous=true면 그 인물의 다른 활성 배정 종료)
//   set_representative { assignment_id }
//   end_assignment     { assignment_id }
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ candidates: [] })
  const { data: people, error } = await admin
    .from('contacts').select('id, name, phone, email')
    .ilike('name', `%${q}%`).is('merged_into_id', null).limit(10)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const out = []
  for (const p of people ?? []) {
    const { data: asgn } = await admin
      .from('contact_assignments')
      .select('title, started_at, ended_at, vendors(name)')
      .eq('contact_id', p.id)
      .order('started_at', { ascending: false })
      .limit(5)
    out.push({
      ...p,
      history: (asgn ?? []).map(a => ({
        vendor_name: (a.vendors as { name?: string } | null)?.name ?? '?',
        title: a.title, started_at: a.started_at, ended_at: a.ended_at,
      })),
    })
  }
  return NextResponse.json({ candidates: out })
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | boolean | undefined>
  const action = body.action as string
  const todayStr = new Date().toISOString().slice(0, 10)

  const clearRep = async (vendorId: string) => {
    await admin.from('contact_assignments').update({ is_representative: false })
      .eq('vendor_id', vendorId).is('ended_at', null).eq('is_representative', true)
  }

  const doAssign = async (vendorId: string, contactId: string) => {
    const { data: dup } = await admin.from('contact_assignments').select('id')
      .eq('vendor_id', vendorId).eq('contact_id', contactId).is('ended_at', null).maybeSingle()
    if (dup) return { error: '이미 배정된 담당자입니다.' }
    if (body.is_representative === true) await clearRep(vendorId)
    const { error } = await admin.from('contact_assignments').insert({
      vendor_id: vendorId, contact_id: contactId,
      title: String(body.title ?? '').trim() || null,
      role_memo: String(body.role_memo ?? '').trim() || null,
      is_representative: body.is_representative === true,
      started_at: todayStr,
    })
    return error ? { error: error.message } : { ok: true as const }
  }

  if (action === 'assign_new') {
    const vendorId = String(body.vendor_id ?? '')
    const name = String(body.name ?? '').trim()
    if (!vendorId || !name) return NextResponse.json({ error: '거래처와 이름이 필요합니다.' }, { status: 400 })
    const phone = String(body.phone ?? '').trim() || null

    // 동일 인물 후보: 같은 번호(강한 근거) 또는 같은 이름 — 자동 병합하지 않고 사용자에게 확인
    if (body.force !== true) {
      let cand = phone
        ? (await admin.from('contacts').select('id, name, phone').eq('phone', phone).is('merged_into_id', null)).data ?? []
        : []
      if (!cand.length) {
        cand = (await admin.from('contacts').select('id, name, phone').eq('name', name).is('merged_into_id', null)).data ?? []
      }
      if (cand.length) {
        return NextResponse.json({ needs_confirm: true, candidates: cand })
      }
    }

    const { data: person, error: pErr } = await admin.from('contacts')
      .insert({ name, phone, email: String(body.email ?? '').trim() || null }).select('id').single()
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    const r = await doAssign(vendorId, person.id)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, contact_id: person.id })
  }

  if (action === 'assign') {
    const vendorId = String(body.vendor_id ?? '')
    const contactId = String(body.contact_id ?? '')
    if (!vendorId || !contactId) return NextResponse.json({ error: '거래처와 인물이 필요합니다.' }, { status: 400 })
    if (body.end_previous === true) {
      // 이동 처리 — 이 인물의 다른 활성 배정을 종료
      await admin.from('contact_assignments')
        .update({ ended_at: todayStr, is_representative: false })
        .eq('contact_id', contactId).is('ended_at', null).neq('vendor_id', vendorId)
    }
    const r = await doAssign(vendorId, contactId)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_representative') {
    const id = String(body.assignment_id ?? '')
    const { data: row, error: e1 } = await admin.from('contact_assignments')
      .select('vendor_id').eq('id', id).single()
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    await clearRep(row.vendor_id)
    const { error } = await admin.from('contact_assignments').update({ is_representative: true }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'end_assignment') {
    const id = String(body.assignment_id ?? '')
    const { error } = await admin.from('contact_assignments')
      .update({ ended_at: todayStr, is_representative: false }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
