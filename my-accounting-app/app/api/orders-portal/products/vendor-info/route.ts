import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { PERMISSION_CONTACT } from '@/lib/help-registry'

export const dynamic = 'force-dynamic'

// 품목 수정 화면의 매입처 담당자 · 연락처 · 이메일 (2026-11-10 사용자 확정, docs/product-master-track.md)
// GET  ?name=매입처명 → 품목의 매입처명 → 매입 별칭(병합 대표 추적) → vendors
//      (가) vendors.contact_name · contact_phone · email 을 보여 주고, 빈 칸만 (나) 거래처 담당자의 대표 담당자로 채움(칸마다 출처 표시)
//      별칭이 없거나 매입처에 연결되지 않았으면 linked:false — 화면은 입력을 막고 연결 안내만
// POST { name, contact_name, contact_phone, email } → (가) vendors 갱신 = 그 매입처의 모든 품목 · 원가표 다운로드 · 발주 이메일에 반영
//      품목에 따로 저장하지 않는다. 매입처 관리(거래처 관리 그룹) 수정 권한 필요 — 품목 관리 권한만으로는 불가.
//      (미들웨어가 /api/orders-portal POST에 영업·주문 수정 권한을 먼저 요구)
// (나) 담당자 패널(contacts)은 읽기만 한다 — 수정은 매입처 관리 화면.

type Source = 'vendor' | 'contact' | null
interface Field { value: string; source: Source }

async function resolveVendor(admin: ReturnType<typeof createAdminClient>, name: string) {
  const { data: alias } = await admin.from('erp_vendor_aliases')
    .select('id, vendor_id, merged_into_alias_id')
    .eq('alias_type', 'purchase').eq('erp_name', name).maybeSingle()
  if (!alias) return { aliasFound: false, vendorId: null as string | null }
  let cur = alias as { id: string; vendor_id: string | null; merged_into_alias_id: string | null }
  for (let i = 0; i < 5 && cur.merged_into_alias_id; i++) {
    const { data: rep } = await admin.from('erp_vendor_aliases')
      .select('id, vendor_id, merged_into_alias_id').eq('id', cur.merged_into_alias_id).maybeSingle()
    if (!rep) break
    cur = rep as typeof cur
  }
  return { aliasFound: true, vendorId: cur.vendor_id }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const name = (req.nextUrl.searchParams.get('name') ?? '').trim()
  const canEditVendor = can(me, 'customers', 'edit')
  const canLink = can(me, 'tools', 'view')   // 매입처 연결 키워드 화면(점검 · 정리 도구)
  if (!name) return NextResponse.json({ linked: false, reason: 'no_name', can_edit_vendor: canEditVendor, can_link: canLink, link_contact: PERMISSION_CONTACT.tools })

  const admin = createAdminClient()
  const { aliasFound, vendorId } = await resolveVendor(admin, name)
  if (!vendorId) {
    return NextResponse.json({
      linked: false, reason: aliasFound ? 'vendor_unlinked' : 'no_alias',
      can_edit_vendor: canEditVendor, can_link: canLink, link_contact: PERMISSION_CONTACT.tools,
    })
  }

  const [{ data: vendor, error }, { data: rep }] = await Promise.all([
    admin.from('vendors').select('id, name, contact_name, contact_phone, email').eq('id', vendorId).maybeSingle(),
    admin.from('contact_assignments')
      .select('title, contacts(name, phone, tel, email)')
      .eq('vendor_id', vendorId).eq('is_representative', true).is('ended_at', null)
      .limit(1).maybeSingle(),
  ])
  if (error || !vendor) {
    return NextResponse.json({ error: error?.message ?? '매입처를 찾지 못했습니다.' }, { status: 500 })
  }
  const c = (rep?.contacts ?? null) as unknown as { name: string; phone: string | null; tel: string | null; email: string | null } | null
  const pick = (own: string | null, fallback: string | null | undefined): Field => {
    const o = (own ?? '').trim()
    if (o) return { value: o, source: 'vendor' }
    const f = (fallback ?? '').trim()
    return f ? { value: f, source: 'contact' } : { value: '', source: null }
  }
  return NextResponse.json({
    linked: true,
    vendor: { id: vendor.id, name: vendor.name },
    // 인물 마스터에는 이름만 — 직함은 배정(title)에서, 존칭은 화면 표시에서
    rep_title: (rep?.title as string | null) ?? null,
    fields: {
      contact_name: pick(vendor.contact_name as string | null, c?.name),
      contact_phone: pick(vendor.contact_phone as string | null, c?.phone || c?.tel),
      email: pick(vendor.email as string | null, c?.email),
    },
    // 저장 시 비교 기준 — (가) 원래 값 (나에서 채운 칸은 빈 값)
    original: {
      contact_name: (vendor.contact_name as string | null) ?? '',
      contact_phone: (vendor.contact_phone as string | null) ?? '',
      email: (vendor.email as string | null) ?? '',
    },
    can_edit_vendor: canEditVendor,
    can_link: canLink, link_contact: PERMISSION_CONTACT.tools,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'customers', 'edit')) {
    return NextResponse.json({
      error: `매입처 담당자 · 연락처 · 이메일 수정은 거래처 관리(매입처 관리) 수정 권한이 필요합니다. 권한은 ${PERMISSION_CONTACT.customers}에게 요청하세요.`,
    }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as {
    name?: string; contact_name?: string | null; contact_phone?: string | null; email?: string | null
  } | null
  const name = (body?.name ?? '').trim()
  if (!name) return NextResponse.json({ error: '매입처명이 필요합니다.' }, { status: 400 })

  const admin = createAdminClient()
  const { vendorId } = await resolveVendor(admin, name)
  if (!vendorId) {
    return NextResponse.json({ error: '매입처 미연결 — 매입처 연결 키워드에서 먼저 연결해야 저장할 수 있습니다.' }, { status: 400 })
  }

  // 보낸 칸만 갱신 (화면은 바뀐 칸만 보냄)
  const patch: Record<string, string | null> = {}
  for (const k of ['contact_name', 'contact_phone', 'email'] as const) {
    if (body && k in body) patch[k] = (body[k] ?? '').trim() || null
  }
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
    return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true, updated: 0 })

  const { error } = await admin.from('vendors').update(patch).eq('id', vendorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updated: Object.keys(patch).length, vendor_id: vendorId })
}
