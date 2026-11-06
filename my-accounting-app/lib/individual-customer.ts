import type { SupabaseClient } from '@supabase/supabase-js'
import { parseManagerName } from '@/lib/contact-resolve'

// ─────────────────────────────────────────────────────────
// 개인 고객 자동 분리 — 115 (2026-11-06 사용자 승인 "A안", 시안 docs/mockups/개인고객_분리_시안.html)
//
// 업체 '개인'(vendor_groups.is_individual)의 주문 · 상담은 지점명과 상관없이 고객(인물)마다
// 전용 매출처("개인 {이름}", vendors.individual_contact_id)로 연결한다. 직원 입력은 그대로
// (업체 개인 · 지점 공란 · 담당자 = 주문자), 매출처는 시스템이 찾거나 만든다.
//   - 기준은 이름이 아니라 인물(고객코드) — 동명이인은 전화번호로 구분.
//   - 업체 이름과 같은 매출처('개인')는 입력 창구. 모임(심통회 등)은 일반 지점과 같다.
// 115 미적용 환경: 모든 함수가 "개인 업체 없음"으로 동작한다(기존 흐름 그대로).
// ─────────────────────────────────────────────────────────

const norm = (s: string) => s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '').replace(/\s+/g, '').toLowerCase()
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

// ERP 별칭 = 매출처 이름. 이미 있는데 매출처 미연결이면 연결한다.
async function ensureCustomerAlias(admin: SupabaseClient, name: string, vendorId: string) {
  await admin.from('erp_vendor_aliases')
    .upsert({ alias_type: 'customer', erp_name: name, vendor_id: vendorId }, { onConflict: 'alias_type,erp_name', ignoreDuplicates: true })
  await admin.from('erp_vendor_aliases').update({ vendor_id: vendorId })
    .eq('alias_type', 'customer').eq('erp_name', name).is('vendor_id', null)
}

export interface IndividualCustomer {
  vendor_id: string
  vendor_name: string
  contact_id: string
  name: string
  title: string | null
  phone: string | null
  code: string | null
  staff_employee_id: string | null
}

// 개인 고객 업체 id 목록 (115 미적용 = 빈 집합)
export async function loadIndividualGroupIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin.from('vendor_groups').select('id').eq('is_individual', true)
  if (error) return new Set()
  return new Set((data ?? []).map(g => g.id as string))
}

interface VendorInfo {
  id: string; name: string; group_id: string | null; group_name: string | null
  is_individual_group: boolean; individual_contact_id: string | null
}

// 매출처 하나의 개인 고객 관련 정보 (115 미적용이면 null)
export async function loadVendorIndividualInfo(admin: SupabaseClient, vendorId: string): Promise<VendorInfo | null> {
  const { data, error } = await admin.from('vendors')
    .select('id, name, group_id, individual_contact_id, vendor_groups(name, is_individual)')
    .eq('id', vendorId).maybeSingle()
  if (error || !data) return null
  const g = data.vendor_groups as unknown as { name: string; is_individual: boolean } | null
  return {
    id: data.id as string, name: data.name as string, group_id: (data.group_id as string | null) ?? null,
    group_name: g?.name ?? null, is_individual_group: !!g?.is_individual,
    individual_contact_id: (data.individual_contact_id as string | null) ?? null,
  }
}

// 입력 창구(업체 이름과 같은 매출처)인지
export const isEntryVendor = (v: VendorInfo) =>
  v.is_individual_group && !v.individual_contact_id && !!v.group_name && norm(v.name) === norm(v.group_name)

// 업체의 개인 고객 목록 — 고객 매출처 + 그 매출처의 현재 배정(직함 · 다올 담당)
export async function listIndividualCustomers(admin: SupabaseClient, groupId: string): Promise<IndividualCustomer[]> {
  const { data: vs, error } = await admin.from('vendors')
    .select('id, name, individual_contact_id, contacts(id, name, phone, code)')
    .eq('group_id', groupId).not('individual_contact_id', 'is', null).neq('status', 'merged').eq('is_active', true)
    .order('name').limit(2000)
  if (error || !vs?.length) return []
  const ids = vs.map(v => v.id as string)
  const asg = new Map<string, { title: string | null; staff: string | null }>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await admin.from('contact_assignments')
      .select('vendor_id, contact_id, title, staff_employee_id')
      .in('vendor_id', ids.slice(i, i + 150)).is('ended_at', null)
    for (const a of data ?? []) {
      asg.set(`${a.vendor_id}|${a.contact_id}`, { title: (a.title as string | null) ?? null, staff: (a.staff_employee_id as string | null) ?? null })
    }
  }
  return vs.flatMap(v => {
    const c = v.contacts as unknown as { id: string; name: string; phone: string | null; code: string | null } | null
    if (!c) return []
    const a = asg.get(`${v.id}|${c.id}`)
    return [{
      vendor_id: v.id as string, vendor_name: v.name as string, contact_id: c.id,
      name: c.name, title: a?.title ?? null, phone: c.phone, code: c.code ?? null,
      staff_employee_id: a?.staff ?? null,
    }]
  })
}

// 고객 매출처 이름: "개인 {이름}", 같은 업체에 같은 이름의 다른 고객이 있으면 "(전화 뒷 4자리)"
async function individualVendorName(admin: SupabaseClient, groupId: string, groupName: string, name: string, phone: string | null) {
  const base = `${groupName} ${name}`
  const { data } = await admin.from('vendors').select('id, name').eq('group_id', groupId).neq('status', 'merged')
  const taken = new Set((data ?? []).map(v => norm(v.name as string)))
  if (!taken.has(norm(base))) return base
  const tail = digits(phone).slice(-4)
  if (tail) {
    const withTail = `${base}(${tail})`
    if (!taken.has(norm(withTail))) return withTail
  }
  for (let i = 2; i < 50; i++) if (!taken.has(norm(`${base}(${i})`))) return `${base}(${i})`
  return `${base}(${Date.now() % 10000})`
}

// 인물의 고객 매출처를 찾거나 만든다. 배정(직함 · 다올 담당) · 지점 담당 · ERP 별칭도 맞춘다.
export async function ensureIndividualVendor(admin: SupabaseClient, input: {
  groupId: string; contactId: string; title?: string | null; staffEmployeeId?: string | null; startedAt?: string | null
}): Promise<{ vendorId: string; vendorName: string; created: boolean } | { error: string }> {
  const { data: found } = await admin.from('vendors').select('id, name, is_active')
    .eq('individual_contact_id', input.contactId).neq('status', 'merged').maybeSingle()
  let vendorId = found?.id as string | undefined
  let vendorName = found?.name as string | undefined
  let created = false
  if (found && found.is_active === false) await admin.from('vendors').update({ is_active: true }).eq('id', found.id)

  if (!vendorId) {
    const [{ data: g }, { data: c }] = await Promise.all([
      admin.from('vendor_groups').select('id, name').eq('id', input.groupId).maybeSingle(),
      admin.from('contacts').select('id, name, phone').eq('id', input.contactId).maybeSingle(),
    ])
    if (!g || !c) return { error: '업체 또는 고객을 찾을 수 없습니다.' }
    vendorName = await individualVendorName(admin, g.id as string, g.name as string, c.name as string, (c.phone as string | null) ?? null)
    const ins = await admin.from('vendors').insert({
      name: vendorName, type: 'customer', is_active: true, group_id: g.id, individual_contact_id: c.id,
    }).select('id').single()
    if (ins.error) return { error: `고객 매출처 생성 실패: ${ins.error.message}` }
    vendorId = ins.data.id as string
    created = true
  }

  // 현재 배정 (없으면 생성 — 이 업체의 다른 배정에서 직함 · 다올 담당을 이어받는다)
  const { data: cur } = await admin.from('contact_assignments')
    .select('id, title, staff_employee_id').eq('vendor_id', vendorId).eq('contact_id', input.contactId).is('ended_at', null).limit(1)
  let staff = input.staffEmployeeId ?? (cur?.[0]?.staff_employee_id as string | null | undefined) ?? null
  if (!cur?.length) {
    let title = input.title ?? null
    if (!title || !staff) {
      const { data: prev } = await admin.from('contact_assignments')
        .select('title, staff_employee_id, vendors!inner(group_id)')
        .eq('contact_id', input.contactId).eq('vendors.group_id', input.groupId)
        .order('started_at', { ascending: false, nullsFirst: false }).limit(1)
      title = title ?? (prev?.[0]?.title as string | null | undefined) ?? null
      staff = staff ?? (prev?.[0]?.staff_employee_id as string | null | undefined) ?? null
    }
    const { error } = await admin.from('contact_assignments').insert({
      contact_id: input.contactId, vendor_id: vendorId, title, staff_employee_id: staff,
      is_representative: true, started_at: input.startedAt ?? new Date().toISOString().slice(0, 10),
    })
    if (error) return { error: `고객 배정 실패: ${error.message}` }
  } else if (input.staffEmployeeId && !cur[0].staff_employee_id) {
    await admin.from('contact_assignments').update({ staff_employee_id: input.staffEmployeeId }).eq('id', cur[0].id)
  }

  // 지점 담당 = 고객의 다올 담당 (없을 때만)
  if (staff) {
    const { data: vs } = await admin.from('vendor_staff').select('id').eq('vendor_id', vendorId).is('ended_at', null).limit(1)
    if (!vs?.length) await admin.from('vendor_staff').insert({ vendor_id: vendorId, employee_id: staff, is_primary: true })
  }

  // ERP 별칭 = 매출처 이름 (주문 저장이 이 별칭으로 연결된다)
  await ensureCustomerAlias(admin, vendorName!, vendorId!)

  return { vendorId: vendorId!, vendorName: vendorName!, created }
}

// 같은 업체에 같은 이름의 개인 고객이 있는지 (신규 등록 전 확인)
export async function findSameNameCustomers(admin: SupabaseClient, groupId: string, name: string) {
  const list = await listIndividualCustomers(admin, groupId)
  return list.filter(c => c.name === name.trim())
}

// 신규 개인 고객 등록: 인물 + 고객 매출처. 같은 이름이 있으면 전화번호가 있어야 새로 만든다.
export async function createIndividualCustomer(admin: SupabaseClient, input: {
  groupId: string; name: string; title?: string | null; phone?: string | null; staffEmployeeId: string; forceNew?: boolean
}): Promise<
  | { ok: true; vendorId: string; vendorName: string; contactId: string }
  | { duplicates: IndividualCustomer[]; needPhone: boolean }
  | { error: string }
> {
  const name = input.name.trim()
  if (!/^[가-힣A-Za-z][가-힣A-Za-z\s]{0,19}$/.test(name)) return { error: '고객 이름을 확인하세요(직함은 직함 칸에).' }
  const phone = input.phone?.trim() || null
  const dups = await findSameNameCustomers(admin, input.groupId, name)
  if (dups.length) {
    if (!input.forceNew) return { duplicates: dups, needPhone: !phone }
    if (!phone) return { duplicates: dups, needPhone: true }
    if (dups.some(d => digits(d.phone) && digits(d.phone) === digits(phone))) {
      return { error: '같은 이름 · 같은 전화번호의 고객이 이미 있습니다 — 그 고객을 선택하세요.' }
    }
  }
  const { data: c, error } = await admin.from('contacts').insert({ name, phone, note: '개인 고객 등록' }).select('id').single()
  if (error || !c) return { error: `고객 등록 실패: ${error?.message ?? ''}` }
  const r = await ensureIndividualVendor(admin, {
    groupId: input.groupId, contactId: c.id as string, title: input.title ?? null, staffEmployeeId: input.staffEmployeeId,
  })
  if ('error' in r) return r
  return { ok: true, vendorId: r.vendorId, vendorName: r.vendorName, contactId: c.id as string }
}

// 주문 · 상담 저장 가드: 개인 업체의 입력 창구(또는 다른 고객의 매출처)가 넘어오면
// 고객(인물)의 매출처로 바꾼다. 모임 등 일반 지점은 그대로. 해당 없으면 null.
export async function resolveIndividualVendorForSave(admin: SupabaseClient, input: {
  vendorId: string | null; groupId?: string | null; contactId: string | null; rawName?: string | null
  phone?: string | null; eventDate?: string | null; allowCreate?: boolean
}): Promise<{ vendorId: string; contactId: string } | null> {
  let info: VendorInfo | null = null
  let groupId = input.groupId ?? null
  if (input.vendorId) {
    info = await loadVendorIndividualInfo(admin, input.vendorId)
    if (!info || !info.is_individual_group) return null
    // 모임 등 일반 지점
    if (!info.individual_contact_id && !isEntryVendor(info)) return null
    groupId = info.group_id
  } else if (groupId) {
    const { data: g, error } = await admin.from('vendor_groups').select('is_individual').eq('id', groupId).maybeSingle()
    if (error || !g?.is_individual) return null
  } else return null
  if (!groupId) return null

  let contactId = input.contactId
  // 담당자를 고르지 않고 이름만 적은 경우(상담): 같은 업체의 개인 고객 중 이름이 하나만 맞으면 그 고객,
  // 없으면 새 고객(allowCreate), 여럿이면 판단을 사람에게 남긴다.
  if (!contactId && input.rawName) {
    const parsed = parseManagerName(input.rawName)
    if (!parsed) return null
    const same = await findSameNameCustomers(admin, groupId, parsed.name)
    const tail = digits(input.phone).slice(-4)
    const byPhone = tail ? same.filter(c => digits(c.phone).endsWith(tail)) : []
    if (byPhone.length === 1) contactId = byPhone[0].contact_id
    else if (same.length === 1 && !byPhone.length && !(tail && digits(same[0].phone))) contactId = same[0].contact_id
    else if (same.length === 0 && input.allowCreate) {
      const { data: c } = await admin.from('contacts').insert({ name: parsed.name, phone: input.phone?.trim() || null, note: '개인 고객 자동 등록(상담)' }).select('id').single()
      if (!c) return null
      const r = await ensureIndividualVendor(admin, { groupId, contactId: c.id as string, title: parsed.title, startedAt: input.eventDate })
      if ('error' in r) return null
      return { vendorId: r.vendorId, contactId: c.id as string }
    } else return null
  }
  if (!contactId) return null
  if (info?.individual_contact_id === contactId) return { vendorId: info.id, contactId }
  const r = await ensureIndividualVendor(admin, { groupId, contactId, startedAt: input.eventDate })
  if ('error' in r) return null
  return { vendorId: r.vendorId, contactId }
}

// 인물 이름이 바뀌면 고객 매출처 이름도 따라간다(옛 이름은 별칭 보존)
export async function syncIndividualVendorName(admin: SupabaseClient, contactId: string) {
  const { data: v, error } = await admin.from('vendors')
    .select('id, name, group_id, match_aliases, vendor_groups(name)')
    .eq('individual_contact_id', contactId).neq('status', 'merged').maybeSingle()
  if (error || !v || !v.group_id) return
  const { data: c } = await admin.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
  const gName = (v.vendor_groups as unknown as { name: string } | null)?.name
  if (!c || !gName) return
  if (norm(v.name as string).startsWith(norm(`${gName} ${c.name}`))) return
  const next = await individualVendorName(admin, v.group_id as string, gName, c.name as string, (c.phone as string | null) ?? null)
  const aliases = Array.from(new Set([...((v.match_aliases as string[] | null) ?? []), v.name as string])).filter(a => a && a !== next)
  await admin.from('vendors').update({ name: next, match_aliases: aliases }).eq('id', v.id)
  await ensureCustomerAlias(admin, next, v.id as string)
}

// 인물 병합 뒤: 흡수된 인물의 고객 매출처를 남는 인물 쪽으로 정리한다.
//  - 남는 인물에 고객 매출처가 없으면 연결만 옮기고 이름을 맞춘다.
//  - 둘 다 있으면 merge_vendor 로 합친다(별칭 · 원장 이전). 흡수 이름이 공용 이름이면 별칭에서 뺀다.
export async function followContactMerge(admin: SupabaseClient, sourceId: string, targetId: string) {
  const { data: src, error } = await admin.from('vendors').select('id, name')
    .eq('individual_contact_id', sourceId).neq('status', 'merged').maybeSingle()
  if (error || !src) return
  const { data: tgt } = await admin.from('vendors').select('id, name, match_aliases')
    .eq('individual_contact_id', targetId).neq('status', 'merged').maybeSingle()
  if (!tgt) {
    await admin.from('vendors').update({ individual_contact_id: targetId }).eq('id', src.id)
    await syncIndividualVendorName(admin, targetId)
    return
  }
  // 고객 매출처 둘 → 하나 (배정 · 표기 · 스냅샷 · 상담은 직접 옮기고 나머지는 병합 함수)
  for (const t of ['contact_name_links', 'doc_sales_snapshot', 'erp_consultations'] as const) {
    await admin.from(t).update({ vendor_id: tgt.id }).eq('vendor_id', src.id)
  }
  await admin.from('contact_assignments').update({ is_representative: false }).eq('vendor_id', src.id)
  await admin.rpc('merge_vendor_extra_refs', { p_from: src.id, p_into: tgt.id })
  await admin.rpc('merge_vendor', { p_from: src.id, p_into: tgt.id, p_actor: '인물 병합 연동(개인 고객)' })
}

// 상담 저장 공통: 업체 '개인'이면 고객 전용 매출처로 연결하고 지점명은 비운다(사용자 결정 — 지점 공란).
export async function applyIndividualToConsultFields(admin: SupabaseClient, f: {
  vendor_group_id: string | null; vendor_id: string | null; contact_id: string | null
  branch_name: string | null; manager_name: string | null; phone: string | null; consult_date: string
}) {
  const r = await resolveIndividualVendorForSave(admin, {
    vendorId: f.vendor_id, groupId: f.vendor_group_id, contactId: f.contact_id,
    rawName: f.manager_name, phone: f.phone, eventDate: f.consult_date, allowCreate: true,
  })
  if (!r) return false
  f.vendor_id = r.vendorId
  f.contact_id = r.contactId
  f.branch_name = null
  return true
}

// 개인 고객 전용 매출처 id 집합 (목록 배지 · 칩용, 115 미적용 = 빈 집합)
export async function loadIndividualVendorIds(admin: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('vendors').select('id')
      .not('individual_contact_id', 'is', null).order('id').range(from, from + 999)
    if (error) return out
    for (const v of data ?? []) out.add(v.id as string)
    if ((data ?? []).length < 1000) return out
  }
}

// 360° 상세용: 고객 전용 매출처면 고객 정보 + 같은 인물의 다른 거래처(현재 배정)
export async function loadIndividualDetail(admin: SupabaseClient, vendorId: string): Promise<{
  contact_id: string; name: string; code: string | null; phone: string | null
  others: { vendor_id: string; vendor_name: string; title: string | null }[]
} | null> {
  const { data: v, error } = await admin.from('vendors').select('individual_contact_id').eq('id', vendorId).maybeSingle()
  if (error || !v?.individual_contact_id) return null
  const cid = v.individual_contact_id as string
  const [{ data: c }, { data: asg }] = await Promise.all([
    admin.from('contacts').select('id, name, code, phone').eq('id', cid).maybeSingle(),
    admin.from('contact_assignments').select('vendor_id, title, vendors(name, status)')
      .eq('contact_id', cid).is('ended_at', null).neq('vendor_id', vendorId),
  ])
  if (!c) return null
  return {
    contact_id: cid, name: c.name as string, code: (c.code as string | null) ?? null, phone: (c.phone as string | null) ?? null,
    others: (asg ?? []).flatMap(a => {
      const vv = a.vendors as unknown as { name: string; status: string | null } | null
      return vv && vv.status !== 'merged' ? [{ vendor_id: a.vendor_id as string, vendor_name: vv.name, title: (a.title as string | null) ?? null }] : []
    }),
  }
}
