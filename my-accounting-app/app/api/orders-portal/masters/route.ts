import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// 주문 입력용 마스터 조회
// GET                     → { vendors, employees }  (폼 최초 로드)
// GET ?vendor_id=<id>     → { contacts }            (주문처 선택 시 담당자 목록)
// POST { action: 'create_contact', vendor_id, name, phone?, title? }
//   → 담당자 마스터에 없는 인물을 그 자리에서 등록 (contacts + 현재 배정)
// POST { action: 'create_sales_vendor', group_id?, group_name?, branch_name?,
//        contact_name?, contact_title?, contact_phone? }
//   → 상담일지 인라인 등록 (2026-08-26 사용자 확정): 자유 입력한 업체·지점·담당자를
//     매출처 마스터에 그 자리에서 등록. 정규화 이름이 같은 기존 지점·담당자가 있으면
//     새로 만들지 않고 연결(reused) — 중복 오염 방지.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const vendorId = new URL(req.url).searchParams.get('vendor_id')

  if (vendorId) {
    const { data, error } = await admin
      .from('contact_assignments')
      .select('contact_id, title, is_representative, contacts(id, name, phone)')
      .eq('vendor_id', vendorId)
      .is('ended_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const contacts = (data ?? [])
      .map(a => {
        const c = a.contacts as unknown as { id: string; name: string; phone: string | null } | null
        return c && {
          contact_id: c.id, name: c.name, phone: c.phone,
          title: a.title as string | null,
          is_representative: !!a.is_representative,
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b!.is_representative) - Number(a!.is_representative))
    return NextResponse.json({ contacts })
  }

  // 505 미적용 폴백: group_id 없이 재시도
  let vendorsResult = await fetchAllRows<{ id: string; name: string; type: string | null; group_id?: string | null }>(
    (from, to) => admin.from('vendors').select('id, name, type, group_id')
      .eq('is_active', true).order('name').range(from, to),
  )
  if ('error' in vendorsResult) {
    vendorsResult = await fetchAllRows<{ id: string; name: string; type: string | null }>(
      (from, to) => admin.from('vendors').select('id, name, type')
        .eq('is_active', true).order('name').range(from, to),
    )
  }
  const [groupsResult, employeesResult] = await Promise.all([
    admin.from('vendor_groups').select('id, name').eq('is_active', true).order('name'),
    admin.from('employees').select('id, name, position, team')
      .eq('is_active', true).order('name'),
  ])
  if ('error' in vendorsResult) return NextResponse.json({ error: vendorsResult.error }, { status: 500 })
  if (employeesResult.error) return NextResponse.json({ error: employeesResult.error.message }, { status: 500 })

  return NextResponse.json({
    vendors: vendorsResult.data,
    groups: groupsResult.error ? [] : (groupsResult.data ?? []),   // 505 미적용 시 빈 배열
    employees: employeesResult.data ?? [],
    me: { employee_id: me.employeeId, name: me.employeeName, role: me.role },
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | undefined>

  if (body.action === 'create_sales_vendor') {
    // 정규화: 법인 접두·공백 제거 후 비교 (branchLabel·702 보정과 동일 규칙)
    const norm = (s: string) =>
      s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '').replace(/\s+/g, '').toLowerCase()
    const groupIdIn = (body.group_id ?? '').trim() || null
    const groupName = (body.group_name ?? '').trim()
    const branchName = (body.branch_name ?? '').trim()
    if (!groupIdIn && !groupName) {
      return NextResponse.json({ error: '업체명을 입력해주세요.' }, { status: 400 })
    }

    // 1) 업체(그룹) — 지점명이 있을 때만 그룹을 쓴다. 없으면 단일 업체(vendors 단독).
    let groupId = groupIdIn
    let groupLabel = groupName
    if (groupIdIn) {
      const { data: g } = await admin.from('vendor_groups').select('id, name').eq('id', groupIdIn).maybeSingle()
      if (!g) return NextResponse.json({ error: '선택한 업체를 찾을 수 없습니다.' }, { status: 400 })
      groupLabel = g.name as string
    } else if (branchName) {
      const { data: groups } = await admin.from('vendor_groups')
        .select('id, name').eq('is_active', true)
      const hit = (groups ?? []).find(g => norm(g.name as string) === norm(groupName))
      if (hit) { groupId = hit.id as string; groupLabel = hit.name as string }
      else {
        const { data: created, error } = await admin.from('vendor_groups')
          .insert({ name: groupName }).select('id').single()
        if (error) return NextResponse.json({ error: `업체 등록 실패: ${error.message}` }, { status: 500 })
        groupId = created.id as string
      }
    }

    // 2) 지점(vendors) — 정규화 동일명이 있으면 재사용 (매출처 목록 오염 방지)
    const vendorName = branchName ? `${groupLabel} ${branchName}` : groupLabel
    const { data: sameGroup } = groupId
      ? await admin.from('vendors').select('id, name').eq('group_id', groupId).eq('is_active', true)
      : await admin.from('vendors').select('id, name').is('group_id', null).eq('is_active', true)
    const existing = (sameGroup ?? []).find(v => norm(v.name as string) === norm(vendorName))
    let vendorId = existing?.id as string | undefined
    const vendorReused = !!existing
    if (!vendorId) {
      const { data: created, error } = await admin.from('vendors')
        .insert({ name: vendorName, type: 'customer', group_id: groupId }).select('id').single()
      if (error) return NextResponse.json({ error: `지점 등록 실패: ${error.message}` }, { status: 500 })
      vendorId = created.id as string
    }

    // 3) 담당자(선택) — 같은 지점에 정규화 동일명이 배정되어 있으면 재사용
    const contactName = (body.contact_name ?? '').trim()
    let contactId: string | null = null
    let contactReused = false
    if (contactName) {
      const { data: asgn } = await admin.from('contact_assignments')
        .select('contact_id, ended_at, contacts(name)')
        .eq('vendor_id', vendorId).is('ended_at', null)
      const hit = (asgn ?? []).find(a => {
        const n = (a.contacts as unknown as { name: string } | null)?.name ?? ''
        return norm(n) === norm(contactName)
      })
      if (hit) { contactId = hit.contact_id as string; contactReused = true }
      else {
        const phone = (body.contact_phone ?? '').trim() || null
        const title = (body.contact_title ?? '').trim() || null
        const { data: contact, error: cErr } = await admin
          .from('contacts').insert({ name: contactName, phone }).select('id').single()
        if (cErr) return NextResponse.json({ error: `담당자 등록 실패: ${cErr.message}` }, { status: 500 })
        const { error: aErr } = await admin.from('contact_assignments').insert({
          contact_id: contact.id, vendor_id: vendorId, title,
          started_at: new Date().toISOString().slice(0, 10),
        })
        if (aErr) return NextResponse.json({ error: `담당자 배정 실패: ${aErr.message}` }, { status: 500 })
        contactId = contact.id as string
      }
    }

    return NextResponse.json({
      group_id: groupId, group_name: groupLabel || null,
      vendor_id: vendorId, vendor_name: vendorName,
      vendor_reused: vendorReused,
      contact_id: contactId, contact_reused: contactReused,
    })
  }

  if (body.action === 'create_contact') {
    const vendorId = body.vendor_id
    const name = (body.name ?? '').trim()
    if (!vendorId || !name) return NextResponse.json({ error: '거래처와 이름이 필요합니다.' }, { status: 400 })
    const phone = (body.phone ?? '').trim() || null
    const title = (body.title ?? '').trim() || null

    const { data: contact, error: cErr } = await admin
      .from('contacts').insert({ name, phone }).select('id').single()
    if (cErr) return NextResponse.json({ error: `담당자 등록 실패: ${cErr.message}` }, { status: 500 })

    const { error: aErr } = await admin.from('contact_assignments').insert({
      contact_id: contact.id, vendor_id: vendorId, title, started_at: new Date().toISOString().slice(0, 10),
    })
    if (aErr) return NextResponse.json({ error: `담당자 배정 실패: ${aErr.message}` }, { status: 500 })
    return NextResponse.json({ contact_id: contact.id })
  }

  // 신규 매출처 인라인 등록 (2026-08-25 확정) — 데이터는 vendors 마스터 단일 원천에
  // 쓴다 (허브에서도 즉시 보임). 같은 이름이 이미 있으면 만들지 않고 그걸 선택한다.
  if (body.action === 'create_vendor') {
    const groupName = (body.group_name ?? '').trim()    // 업체명
    const branchName = (body.branch_name ?? '').trim()  // 지점명 (선택 — 단일 업체는 비움)
    if (!groupName) return NextResponse.json({ error: '업체명을 입력해주세요.' }, { status: 400 })
    const fullName = [groupName, branchName].filter(Boolean).join(' ')

    const { data: existing } = await admin.from('vendors')
      .select('id, group_id').eq('name', fullName).eq('is_active', true)
      .limit(1).maybeSingle()
    if (existing) {
      return NextResponse.json({ vendor_id: existing.id, group_id: existing.group_id ?? null, existed: true })
    }

    // 지점이 있으면 업체 그룹 연결 (없으면 생성). 505 미적용 환경은 그룹 없이 등록.
    let groupId: string | null = null
    if (branchName) {
      const g = await admin.from('vendor_groups').select('id').eq('name', groupName).maybeSingle()
      if (g.data) groupId = g.data.id as string
      else if (!g.error) {
        const ins = await admin.from('vendor_groups').insert({ name: groupName }).select('id').single()
        if (!ins.error) groupId = ins.data.id as string
      }
    }

    let created = await admin.from('vendors')
      .insert({ name: fullName, type: 'customer', is_active: true, ...(groupId ? { group_id: groupId } : {}) })
      .select('id').single()
    if (created.error && groupId && /group_id/i.test(created.error.message)) {
      created = await admin.from('vendors')
        .insert({ name: fullName, type: 'customer', is_active: true }).select('id').single()
    }
    if (created.error) {
      return NextResponse.json({ error: `매출처 등록 실패: ${created.error.message}` }, { status: 500 })
    }
    return NextResponse.json({ vendor_id: created.data.id, group_id: groupId, existed: false })
  }

  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
