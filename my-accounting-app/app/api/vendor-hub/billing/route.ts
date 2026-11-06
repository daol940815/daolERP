import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { buildBillingSuggestions, listBillingEntities } from '@/lib/billing'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MIGRATION_HINT = '마이그레이션 114(청구처)가 아직 실행되지 않았습니다. SQL 편집기에서 114_vendor_billing_entity.sql을 실행해 주세요.'

// GET /api/vendor-hub/billing                — 청구처 지정 추천 · 지정 현황 (+can_edit)
// GET /api/vendor-hub/billing?entities=1&q=  — 청구처로 고를 법인 검색 (사업자번호 있는 거래처)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams
  if (sp.get('entities') === '1') {
    return NextResponse.json({ entities: await listBillingEntities(admin, sp.get('q') ?? '') })
  }
  const r = await buildBillingSuggestions(admin)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  const me = await getCurrentUser()
  return NextResponse.json({ ...r, can_edit: !!me && can(me, 'customers', 'edit') })
}

// POST — { action: 'set', vendor_ids, billing_vendor_id } 청구처 지정
//        { action: 'self', vendor_ids }                     자체 발행으로 확정(다시 추천 안 함)
//        { action: 'clear', vendor_ids }                    청구처 해제(자기 자신) + 자체 발행 표시 해제
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { action?: string; vendor_ids?: string[]; billing_vendor_id?: string }
  const ids = Array.from(new Set((body.vendor_ids ?? []).filter(Boolean)))
  if (!ids.length) return NextResponse.json({ error: '매출처를 선택하세요.' }, { status: 400 })
  if (ids.length > 500) return NextResponse.json({ error: '한 번에 500곳까지 처리할 수 있습니다.' }, { status: 400 })

  const chunks = <T,>(a: T[], n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
  const fail = (msg: string) => NextResponse.json({ error: /billing/.test(msg) ? MIGRATION_HINT : msg }, { status: 500 })

  if (body.action === 'set') {
    const target = body.billing_vendor_id
    if (!target) return NextResponse.json({ error: '청구처를 선택하세요.' }, { status: 400 })
    if (ids.includes(target)) return NextResponse.json({ error: '청구처 법인 자신은 지정 대상에서 빼 주세요.' }, { status: 400 })
    const { data: t, error: te } = await admin.from('vendors')
      .select('id, name, billing_vendor_id, status').eq('id', target).maybeSingle()
    if (te) return fail(te.message)
    if (!t || t.status === 'merged') return NextResponse.json({ error: '청구처 거래처를 찾을 수 없습니다.' }, { status: 400 })
    // 한 단계만 — 청구처 자신이 다른 청구처를 가리키면 안 된다
    if (t.billing_vendor_id) return NextResponse.json({ error: `${t.name}은(는) 다른 청구처를 가리키고 있어 청구처로 쓸 수 없습니다.` }, { status: 400 })
    // 지정 대상이 이미 다른 매출처의 청구처라면(소속이 있으면) 막는다 — 두 단계가 되므로
    for (const c of chunks(ids)) {
      const { data: kids, error } = await admin.from('vendors').select('billing_vendor_id').in('billing_vendor_id', c).limit(1)
      if (error) return fail(error.message)
      if (kids?.length) return NextResponse.json({ error: '선택한 매출처 중 다른 매출처의 청구처로 쓰이는 곳이 있습니다. 그 지정을 먼저 해제하세요.' }, { status: 400 })
    }
    for (const c of chunks(ids)) {
      const { error } = await admin.from('vendors')
        .update({ billing_vendor_id: target, billing_self_confirmed: false }).in('id', c)
      if (error) return fail(error.message)
    }
    return NextResponse.json({ ok: true, count: ids.length, billing_name: t.name })
  }

  if (body.action === 'self' || body.action === 'clear') {
    const patch = body.action === 'self'
      ? { billing_vendor_id: null, billing_self_confirmed: true }
      : { billing_vendor_id: null, billing_self_confirmed: false }
    for (const c of chunks(ids)) {
      const { error } = await admin.from('vendors').update(patch).in('id', c)
      if (error) return fail(error.message)
    }
    return NextResponse.json({ ok: true, count: ids.length })
  }

  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
