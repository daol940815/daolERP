import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPurchaseHubList } from '@/lib/purchase-hub'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/purchase-hub?from=YYYY-MM-DD&to=YYYY-MM-DD
// 매입처 허브 목록 — 기간 매입·지급·미지급 잔액·담당·상태
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildPurchaseHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}

// POST /api/purchase-hub — 신규 매입처 등록 (2026-08-14 사용자 결정)
// 매출처 등록(orders-portal/masters create_sales_vendor)과 같은 모양:
//   업체명(필수) + 지점명 + 담당자명·연락처·직함, 나머지는 전부 선택.
//   지점명을 적으면 업체(vendor_groups) 아래 지점(vendors)으로 만든다.
// 중복 방지(vendors는 매출처와 공유 마스터 — 롯데쇼핑 5분할 사례):
//   · 사업자번호가 같으면 즉시 거부
//   · 이름이 정규화 기준 완전히 같으면 조용히 기존 거래처를 재사용 (직원 손을 덜기 위해)
//   · 비슷하기만 하면 후보를 보여주고 확인받은 뒤에만 새로 만든다
// 등록 즉시 사용 가능하다 — 별도 승인 단계를 두지 않는다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    group_id?: string; group_name?: string; branch_name?: string
    contact_name?: string; contact_phone?: string; contact_title?: string
    biz_number?: string; email?: string; purchase_kind?: string; note?: string
    force?: boolean
  }

  // 법인 접두·공백 무시 (매출처 등록과 동일 규칙)
  const norm = (s: string) =>
    s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '').replace(/\s+/g, '').toLowerCase()

  const groupIdIn = (body.group_id ?? '').trim() || null
  const groupName = (body.group_name ?? '').trim()
  const branchName = (body.branch_name ?? '').trim()
  if (!groupIdIn && !groupName) {
    return NextResponse.json({ error: '업체명을 입력해주세요.' }, { status: 400 })
  }

  const kind = body.purchase_kind ?? 'partner'
  if (!['partner', 'retail', 'expense'].includes(kind)) {
    return NextResponse.json({ error: '매입처 구분이 올바르지 않습니다.' }, { status: 400 })
  }
  const email = (body.email ?? '').trim() || null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const bizDigits = (body.biz_number ?? '').replace(/\D/g, '')
  if (bizDigits && bizDigits.length !== 10) {
    return NextResponse.json({ error: '사업자번호는 숫자 10자리여야 합니다.' }, { status: 400 })
  }
  if (bizDigits) {
    const { data: dup } = await admin.from('vendors')
      .select('id, name').eq('biz_number', bizDigits).maybeSingle()
    if (dup) {
      return NextResponse.json(
        { error: `사업자번호가 같은 거래처가 이미 있습니다: ${dup.name}`, existing_id: dup.id },
        { status: 400 })
    }
  }

  // 1) 업체(그룹) — 지점명이 있을 때만 쓴다. 없으면 단일 업체(vendors 단독).
  //    505 미적용 환경에서도 죽지 않도록 실패하면 그룹 없이 진행한다.
  let groupId = groupIdIn
  let groupLabel = groupName
  if (groupIdIn) {
    const { data: g } = await admin.from('vendor_groups').select('id, name').eq('id', groupIdIn).maybeSingle()
    if (!g) return NextResponse.json({ error: '선택한 업체를 찾을 수 없습니다.' }, { status: 400 })
    groupLabel = g.name as string
  } else if (branchName) {
    const { data: groups, error: gErr } = await admin.from('vendor_groups').select('id, name').eq('is_active', true)
    if (!gErr) {
      const hit = (groups ?? []).find(g => norm(g.name as string) === norm(groupName))
      if (hit) { groupId = hit.id as string; groupLabel = hit.name as string }
      else {
        const { data: created } = await admin.from('vendor_groups').insert({ name: groupName }).select('id').single()
        groupId = (created?.id as string | undefined) ?? null
      }
    }
  }

  const vendorName = branchName ? `${groupLabel} ${branchName}` : groupLabel

  // 담당자 등록·배정 (선택) — 같은 거래처에 같은 이름이 이미 배정돼 있으면 재사용
  const contactName = (body.contact_name ?? '').trim()
  const attachContact = async (vendorId: string) => {
    if (!contactName) return
    const { data: asgn } = await admin.from('contact_assignments')
      .select('contact_id, contacts(name)').eq('vendor_id', vendorId).is('ended_at', null)
    const hit = (asgn ?? []).find(a =>
      norm((a.contacts as unknown as { name: string } | null)?.name ?? '') === norm(contactName))
    if (hit) return
    const { data: contact } = await admin.from('contacts')
      .insert({ name: contactName, phone: (body.contact_phone ?? '').trim() || null })
      .select('id').single()
    if (!contact) return
    await admin.from('contact_assignments').insert({
      contact_id: contact.id,
      vendor_id: vendorId,
      title: (body.contact_title ?? '').trim() || null,
      started_at: new Date().toISOString().slice(0, 10),
    })
  }

  // 2) 완전 동일명이면 기존 거래처 재사용 — 매출처로만 있던 곳이면 매입도 겸하도록 type 보정
  const { data: scope } = groupId
    ? await admin.from('vendors').select('id, name, type').eq('group_id', groupId)
    : await admin.from('vendors').select('id, name, type').is('group_id', null)
  const same = (scope ?? []).find(v => norm(v.name as string) === norm(vendorName))
  if (same) {
    if (same.type === 'customer') {
      await admin.from('vendors').update({ type: 'both' }).eq('id', same.id)
    }
    await attachContact(same.id as string)
    return NextResponse.json({ ok: true, reused: true, vendor: { id: same.id, name: same.name } })
  }

  // 3) 유사 이름 확인 — 확인 전에는 만들지 않는다
  if (!body.force) {
    const key = norm(vendorName)
    const core = key.length >= 2 ? key.slice(0, 2) : key
    const { data: near } = await admin.from('vendors')
      .select('id, name, biz_number, type').ilike('name', `%${core}%`).limit(50)
    const candidates = (near ?? []).filter(v => {
      const n = norm(v.name as string)
      return n.includes(key) || key.includes(n)
    }).slice(0, 5)
    if (candidates.length) return NextResponse.json({ needs_confirm: true, candidates })
  }

  // 4) 생성
  const insert: Record<string, unknown> = {
    name: vendorName,
    biz_number: bizDigits || null,
    email,
    type: 'vendor',
    purchase_kind: kind,
    note: (body.note ?? '').trim() || null,
  }
  if (groupId) insert.group_id = groupId
  const { data: created, error } = await admin.from('vendors').insert(insert).select('id, name').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 미결제금 기초원장 0원 행 — 허브 목록은 계산서·지급·발주·기초원장 중 하나라도
  // 있어야 잡히므로, 이 행이 없으면 등록 직후 목록에 나타나지 않는다.
  await admin.from('purchase_opening_balances').insert({
    vendor_id: created.id,
    as_of_date: '2026-06-30',
    amount: 0,
    note: '신규 매입처 등록 — 기초 미결제 없음',
  })

  await attachContact(created.id as string)
  return NextResponse.json({ ok: true, vendor: created })
}
