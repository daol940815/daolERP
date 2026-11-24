import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { buildHubList } from '@/lib/vendor-hub'
import { findVendorByFullName } from '@/lib/vendor-name-check'
import { isLegalTail } from '@/lib/vendor-group-names'

// ─────────────────────────────────────────────────────────
// 매출처 하위 조직 · 위치 (120) — 2026-11-20 사용자 승인 (시안 docs/mockups/매출처_하위조직_시안.html)
//   팀도 매출처 하나(주문 · 상담 · 담당자가 붙는 단위). vendors.parent_vendor_id = 상위 조직(같은 업체 안),
//   location_vendor_id = 위치(소재 지점 — 소속과 자리가 다를 때만). 청구처(114)와 별개.
//   이름 규칙(사용자 결정): 업체명 + 상위 단위 + 팀명 — 예: '하나은행 원큐 자동차금융팀'.
//   집계는 저장하지 않는다 — 상세 화면에서 트리를 따라 더한다(하위 포함 = 각 조직 숫자의 합).
//   120 미적용이면 available=false — 화면은 하위 조직 기능을 숨긴다.
// ─────────────────────────────────────────────────────────

export const ORG_MAX_DEPTH = 5   // 업체 아래 단계 수 (시안 — 깊이 5)

export interface OrgNode {
  id: string
  name: string
  group_id: string | null
  parent_vendor_id: string | null
  location_vendor_id: string | null
  is_active: boolean
}

const isMissing120 = (msg?: string) => !!msg && /parent_vendor_id|location_vendor_id|vendor_org_changes|schema cache|does not exist/i.test(msg)

// 병합되지 않은 고객 매출처 + 업체 이름. groupId 를 주면 그 업체만.
export async function loadOrgNodes(admin: SupabaseClient, groupId?: string | null): Promise<{ available: boolean; nodes: OrgNode[]; groupName: Map<string, string> }> {
  const r = await fetchAllRows<{ id: string; name: string; group_id: string | null; parent_vendor_id: string | null; location_vendor_id: string | null; is_active: boolean | null }>((f, t) => {
    let q = admin.from('vendors').select('id, name, group_id, parent_vendor_id, location_vendor_id, is_active')
      .neq('status', 'merged').in('type', ['customer', 'both'])
    if (groupId) q = q.eq('group_id', groupId)
    return q.range(f, t)
  })
  const g = await fetchAllRows<{ id: string; name: string }>((f, t) => admin.from('vendor_groups').select('id, name').range(f, t))
  const groupName = new Map(('error' in g ? [] : g.data).map(x => [x.id, x.name]))
  if ('error' in r) return { available: !isMissing120(r.error) ? true : false, nodes: [], groupName }
  return {
    available: true, groupName,
    nodes: r.data.map(v => ({ ...v, is_active: v.is_active !== false })),
  }
}

export function indexNodes(nodes: OrgNode[]) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const children = new Map<string, OrgNode[]>()
  for (const n of nodes) {
    if (!n.parent_vendor_id || !byId.has(n.parent_vendor_id)) continue
    children.set(n.parent_vendor_id, [...(children.get(n.parent_vendor_id) ?? []), n])
  }
  for (const list of Array.from(children.values())) list.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return { byId, children }
}

// 상위들 (업체 바로 아래 → 바로 위 순)
export function ancestorsOf(id: string, byId: Map<string, OrgNode>): OrgNode[] {
  const out: OrgNode[] = []
  const seen = new Set<string>([id])
  let cur = byId.get(id)?.parent_vendor_id ?? null
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = byId.get(cur)
    if (!n) break
    out.unshift(n)
    cur = n.parent_vendor_id
  }
  return out
}

export function descendantIds(id: string, children: Map<string, OrgNode[]>): string[] {
  const out: string[] = []
  const stack = [...(children.get(id) ?? [])]
  while (stack.length) {
    const n = stack.shift()!
    out.push(n.id)
    stack.push(...(children.get(n.id) ?? []))
  }
  return out
}

// 아래로 몇 단계까지 있는지 (자기 = 0)
function subtreeHeight(id: string, children: Map<string, OrgNode[]>, guard = 0): number {
  if (guard > 20) return 0
  const kids = children.get(id) ?? []
  return kids.length ? 1 + Math.max(...kids.map(k => subtreeHeight(k.id, children, guard + 1))) : 0
}

const norm = (s: string) => s.replace(/\s+/g, '')

// 조직 단위 이름 — 상위 조직 이름이 앞에 붙어 있으면 떼고, 아니면 업체명을 뗀다.
// 예: '하나은행 원큐 자동차금융팀'(상위 '하나은행 원큐') → '자동차금융팀', '하나은행 원큐'(상위 없음) → '원큐'
export function unitName(n: OrgNode, byId: Map<string, OrgNode>, groupName: string | null): string {
  const p = n.parent_vendor_id ? byId.get(n.parent_vendor_id) : null
  for (const prefix of [p?.name, groupName].filter(Boolean) as string[]) {
    if (norm(n.name).startsWith(norm(prefix)) && norm(n.name) !== norm(prefix) && !isLegalTail(norm(n.name).slice(norm(prefix).length))) {
      // 원래 띄어쓰기를 살려 앞부분만 뗀다
      let i = 0, k = 0
      const pk = norm(prefix)
      while (i < n.name.length && k < pk.length) { if (n.name[i] !== ' ') k++; i++ }
      return n.name.slice(i).trim()
    }
  }
  return n.name
}

const UNIT_SYNONYMS: [string, string][] = [['1Q', '원큐']]   // [다른 표기, 표준 단위] — 하나은행 원큐(1Q)
// 이름 규칙(사용자 결정 2026-11-20): 업체명 + 상위 단위 + 팀명. 상위가 없으면 업체명 + 팀명.
export function suggestChildName(groupName: string | null, parent: OrgNode | null, byId: Map<string, OrgNode>, childUnit: string): string {
  let unit = childUnit.trim()
  let parentUnit = parent ? unitName(parent, byId, groupName) : ''
  // 상위가 업체명과 같은 이름(업체 메인 매출처)이면 상위 단위를 이름에 넣지 않는다 — '한국수자원공사 한국수자원공사 감사실' 방지(2026-11-24)
  if (groupName && norm(parentUnit) === norm(groupName)) parentUnit = ''
  // 팀명 앞부분이 상위 단위와 겹치면 그 부분을 뗀다 — '원큐자동차금융팀'(상위 '원큐') → '자동차금융팀'
  if (parentUnit) {
    // 같은 단위의 다른 표기(1Q = 원큐)는 맞춰서 비교
    for (const [a, b2] of UNIT_SYNONYMS) {
      if (parentUnit.startsWith(b2) && unit.toUpperCase().startsWith(a.toUpperCase())) unit = b2 + unit.slice(a.length)
    }
    const u = Array.from(unit), pu = Array.from(parentUnit.replace(/\s+/g, ''))
    let i = 0, k = 0
    while (i < u.length && k < pu.length && (u[i] === ' ' || u[i] === pu[k])) { if (u[i] !== ' ') k++; i++ }
    const rest = u.slice(i).join('').trim()
    if (k >= 2 && rest) unit = rest
  }
  return [groupName ?? '', parentUnit, unit].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export interface OrgRow {
  id: string
  name: string
  unit: string
  depth: number           // 이 조직 = 0
  is_self: boolean
  is_active: boolean
  location_name: string | null
  contact_rep: string | null
  contacts: number        // 현재 담당자 수
  staff_primary: string | null
  net: number
  outstanding: number
  order_count: number
}

export interface OrgDetail {
  available: boolean
  path: { id: string; name: string; unit: string }[]     // 상위들 (업체 바로 아래 → 바로 위)
  group: { id: string; name: string } | null
  parent: { id: string; name: string } | null
  location: { id: string; name: string } | null
  unit: string
  rows: OrgRow[]          // 이 조직 + 모든 하위 (트리 순서)
  child_count: number     // 하위 전체 수
  totals: { self: OrgTotals; subtree: OrgTotals }
  changes: { field: string; old_name: string | null; new_name: string | null; changed_by_name: string | null; changed_at: string }[]
  // 이 지점에 있는 조직(2026-11-20) — 위치가 이 매출처인 조직 + 그 하위 중 위치를 따로 정하지 않은 조직.
  // 소속이 다르므로 이 매출처의 숫자(totals)에는 더하지 않는다 — 참고로만 보여 준다.
  located: LocatedRow[]
}
export interface LocatedRow {
  id: string; name: string; path: string; depth: number
  contact_rep: string | null; contacts: number; net: number; outstanding: number; order_count: number
}
export interface OrgTotals { net: number; outstanding: number; order_count: number; contacts: number }

export async function loadOrgDetail(admin: SupabaseClient, vendorId: string, from: string | null, to: string | null): Promise<OrgDetail | { error: string }> {
  const { data: me, error } = await admin.from('vendors').select('id, name, group_id').eq('id', vendorId).maybeSingle()
  if (error || !me) return { error: error?.message ?? '매출처를 찾을 수 없습니다.' }
  const empty: OrgTotals = { net: 0, outstanding: 0, order_count: 0, contacts: 0 }
  const { available, nodes, groupName } = await loadOrgNodes(admin, (me.group_id as string | null) ?? null)
  const gName = me.group_id ? groupName.get(me.group_id as string) ?? null : null
  const base: OrgDetail = {
    available, path: [], group: me.group_id ? { id: me.group_id as string, name: gName ?? '' } : null,
    parent: null, location: null, unit: me.name as string, rows: [], child_count: 0, totals: { self: empty, subtree: empty }, changes: [], located: [],
  }
  if (!available) return base
  // 업체 미지정이면 nodes 에 자기만 없을 수 있다 — 단독으로 다시 읽는다
  let all = nodes
  if (!all.some(n => n.id === vendorId)) {
    const { data } = await admin.from('vendors').select('id, name, group_id, parent_vendor_id, location_vendor_id, is_active').eq('id', vendorId).maybeSingle()
    if (data) all = [...all, { ...(data as OrgNode), is_active: data.is_active !== false }]
  }
  const { byId, children } = indexNodes(all)
  const self = byId.get(vendorId)!
  const desc = descendantIds(vendorId, children)
  const ids = [vendorId, ...desc]

  // 이 지점에 있는 조직: 위치 = 이 매출처(업체가 달라도) + 같은 업체 안 그 하위 중 위치 미지정
  const locatedIds: { id: string; depth: number }[] = []
  {
    const { data: lv } = await admin.from('vendors').select('id, name, group_id, parent_vendor_id, location_vendor_id, is_active')
      .eq('location_vendor_id', vendorId).neq('status', 'merged')
    const seen = new Set<string>()
    const add = (id: string, depth: number) => {
      if (seen.has(id) || id === vendorId) return
      seen.add(id); locatedIds.push({ id, depth })
      for (const c of children.get(id) ?? []) if (!c.location_vendor_id && c.is_active) add(c.id, depth + 1)
    }
    for (const v of (lv ?? []).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))) {
      if (!byId.has(v.id as string)) byId.set(v.id as string, { ...(v as OrgNode), is_active: v.is_active !== false })
      add(v.id as string, 0)
    }
  }
  const numIds = [...ids, ...locatedIds.map(l => l.id)]

  // 위치 이름 (다른 업체일 수도 있어 따로 읽는다)
  const locIds = Array.from(new Set(ids.map(i => byId.get(i)?.location_vendor_id).filter((x): x is string => !!x)))
  const locName = new Map<string, string>()
  if (locIds.length) {
    const { data } = await admin.from('vendors').select('id, name').in('id', locIds)
    for (const v of data ?? []) locName.set(v.id as string, v.name as string)
  }

  // 숫자: 매출처 목록과 같은 계산(기간 매출 · 미수 · 주문) + 현재 담당자 수
  const hub = await buildHubList(admin, from, to)
  const numSet = new Set(numIds)
  const hubRow = new Map(('error' in hub ? [] : hub.rows).filter(r => numSet.has(r.vendor_id)).map(r => [r.vendor_id, r]))
  const contactCount = new Map<string, number>()
  for (let i = 0; i < numIds.length; i += 150) {
    const { data } = await admin.from('contact_assignments').select('vendor_id').in('vendor_id', numIds.slice(i, i + 150)).is('ended_at', null)
    for (const a of data ?? []) contactCount.set(a.vendor_id as string, (contactCount.get(a.vendor_id as string) ?? 0) + 1)
  }

  const rows: OrgRow[] = []
  const walk = (n: OrgNode, depth: number) => {
    const h = hubRow.get(n.id)
    rows.push({
      id: n.id, name: n.name, unit: unitName(n, byId, gName), depth, is_self: n.id === vendorId, is_active: n.is_active,
      location_name: n.location_vendor_id ? locName.get(n.location_vendor_id) ?? null : null,
      contact_rep: h?.contact_rep ?? null, contacts: contactCount.get(n.id) ?? 0, staff_primary: h?.staff_primary ?? null,
      net: h?.net ?? 0, outstanding: h?.outstanding ?? 0, order_count: h?.order_count ?? 0,
    })
    for (const c of children.get(n.id) ?? []) walk(c, depth + 1)
  }
  walk(self, 0)
  const sum = (rs: OrgRow[]): OrgTotals => rs.reduce((a, r) => ({
    net: a.net + r.net, outstanding: a.outstanding + r.outstanding, order_count: a.order_count + r.order_count, contacts: a.contacts + r.contacts,
  }), { ...empty })

  const { data: ch } = await admin.from('vendor_org_changes').select('field, old_name, new_name, changed_by_name, changed_at')
    .eq('vendor_id', vendorId).order('changed_at', { ascending: false }).limit(20)

  const parent = self.parent_vendor_id ? byId.get(self.parent_vendor_id) ?? null : null
  return {
    ...base,
    path: ancestorsOf(vendorId, byId).map(a => ({ id: a.id, name: a.name, unit: unitName(a, byId, gName) })),
    parent: parent ? { id: parent.id, name: parent.name } : null,
    location: self.location_vendor_id ? { id: self.location_vendor_id, name: locName.get(self.location_vendor_id) ?? '' } : null,
    unit: unitName(self, byId, gName),
    rows, child_count: desc.length,
    totals: { self: sum(rows.filter(r => r.is_self)), subtree: sum(rows) },
    changes: (ch ?? []) as OrgDetail['changes'],
    located: locatedIds.map(({ id, depth }) => {
      const n = byId.get(id)!, h = hubRow.get(id)
      const gn = n.group_id ? groupName.get(n.group_id) ?? null : null
      return {
        id, name: n.name, depth,
        path: [...ancestorsOf(id, byId).map(a => unitName(a, byId, gn)), unitName(n, byId, gn)].join(' › '),
        contact_rep: h?.contact_rep ?? null, contacts: contactCount.get(id) ?? 0,
        net: h?.net ?? 0, outstanding: h?.outstanding ?? 0, order_count: h?.order_count ?? 0,
      }
    }),
  }
}

// 상위 조직 후보: 같은 업체, 자기 · 자기 하위 제외, 깊이 제한 안
export async function parentCandidates(admin: SupabaseClient, vendorId: string | null, groupId: string | null, q: string) {
  const { nodes, groupName } = await loadOrgNodes(admin, groupId)
  const { byId, children } = indexNodes(nodes)
  const banned = new Set(vendorId ? [vendorId, ...descendantIds(vendorId, children)] : [])
  const height = vendorId ? subtreeHeight(vendorId, children) : 0
  const key = norm(q).toLowerCase()
  const gName = groupId ? groupName.get(groupId) ?? null : null
  return nodes
    .filter(n => !banned.has(n.id) && n.is_active && (!key || norm(n.name).toLowerCase().includes(key)))
    .filter(n => ancestorsOf(n.id, byId).length + 1 + height + 1 <= ORG_MAX_DEPTH)
    .slice(0, 30)
    .map(n => ({
      id: n.id, name: n.name,
      path: [gName, ...ancestorsOf(n.id, byId).map(a => unitName(a, byId, gName)), unitName(n, byId, gName)].filter(Boolean).join(' › '),
      children: (children.get(n.id) ?? []).length,
    }))
}

// 위치 후보: 활성 고객 매출처 이름 검색 (같은 업체 먼저)
export async function locationCandidates(admin: SupabaseClient, groupId: string | null, q: string, excludeId: string | null) {
  const key = q.trim()
  if (!key) return []
  const { data } = await admin.from('vendors').select('id, name, group_id').neq('status', 'merged').eq('is_active', true)
    .in('type', ['customer', 'both']).ilike('name', `%${key.replace(/\s+/g, '%')}%`).order('name').limit(30)
  return (data ?? []).filter(v => v.id !== excludeId)
    .sort((a, b) => Number(b.group_id === groupId) - Number(a.group_id === groupId))
    .map(v => ({ id: v.id as string, name: v.name as string }))
}

export interface SetOrgInput { parent_id?: string | null; location_id?: string | null; rename?: string | null }
export interface Actor { id: string | null; name: string | null }

// 상위 조직 · 위치 지정 (+ 이름 바꾸기 — 옛 이름은 별칭). 같은 업체 · 순환 · 깊이를 확인하고 이력을 남긴다.
export async function setVendorOrg(admin: SupabaseClient, vendorId: string, input: SetOrgInput, actor: Actor): Promise<{ ok: true } | { error: string }> {
  const { data: v } = await admin.from('vendors').select('id, name, group_id, parent_vendor_id, location_vendor_id, match_aliases').eq('id', vendorId).maybeSingle()
  if (!v) return { error: '매출처를 찾을 수 없습니다.' }
  const patch: Record<string, unknown> = {}
  const changes: Record<string, unknown>[] = []
  const nameOf = async (id: string | null) => {
    if (!id) return null
    const { data } = await admin.from('vendors').select('name').eq('id', id).maybeSingle()
    return (data?.name as string | undefined) ?? null
  }
  if (input.parent_id !== undefined && input.parent_id !== v.parent_vendor_id) {
    if (input.parent_id) {
      const { nodes } = await loadOrgNodes(admin, (v.group_id as string | null) ?? null)
      const { byId, children } = indexNodes(nodes)
      const p = byId.get(input.parent_id)
      if (!p) return { error: '상위 조직은 같은 업체의 활성 매출처만 고를 수 있습니다.' }
      if (p.id === vendorId || descendantIds(vendorId, children).includes(p.id)) return { error: '자기 자신이나 하위 조직은 상위 조직으로 고를 수 없습니다.' }
      if (ancestorsOf(p.id, byId).length + 1 + subtreeHeight(vendorId, children) + 1 > ORG_MAX_DEPTH) return { error: `조직은 업체 아래 ${ORG_MAX_DEPTH}단계까지 만들 수 있습니다.` }
    }
    patch.parent_vendor_id = input.parent_id
    changes.push({ field: 'parent', old_vendor_id: v.parent_vendor_id, old_name: await nameOf(v.parent_vendor_id as string | null), new_vendor_id: input.parent_id, new_name: await nameOf(input.parent_id) })
  }
  if (input.location_id !== undefined && input.location_id !== v.location_vendor_id) {
    if (input.location_id === vendorId) return { error: '자기 자신을 위치로 지정할 수 없습니다.' }
    patch.location_vendor_id = input.location_id
    changes.push({ field: 'location', old_vendor_id: v.location_vendor_id, old_name: await nameOf(v.location_vendor_id as string | null), new_vendor_id: input.location_id, new_name: await nameOf(input.location_id) })
  }
  const newName = input.rename?.trim()
  if (newName && newName !== v.name) {
    const dup = await findVendorByFullName(admin, newName)
    if (dup && dup.id !== vendorId) return { error: `같은 이름의 매출처가 이미 있습니다: ${dup.name}` }
    patch.name = newName
    patch.match_aliases = Array.from(new Set([...((v.match_aliases as string[] | null) ?? []), v.name as string])).filter(a => a !== newName)
  }
  if (!Object.keys(patch).length) return { ok: true }
  const { error } = await admin.from('vendors').update(patch).eq('id', vendorId)
  if (error) return { error: isMissing120(error.message) ? '하위 조직 기능이 아직 적용되지 않았습니다(마이그레이션 120).' : error.message }
  if (changes.length) {
    await admin.from('vendor_org_changes').insert(changes.map(c => ({ ...c, vendor_id: vendorId, changed_by: actor.id, changed_by_name: actor.name })))
  }
  return { ok: true }
}

// 새 하위 조직 등록 — 이름 = 업체명 + 상위 단위 + 팀명. 같은 이름(옛 이름 포함)이 있으면 만들지 않고 알려 준다.
export async function createChildVendor(admin: SupabaseClient, parentId: string, unit: string, locationId: string | null, actor: Actor):
  Promise<{ ok: true; vendor_id: string; name: string } | { error: string; existing?: { id: string; name: string } }> {
  const { data: p } = await admin.from('vendors').select('id, name, group_id, parent_vendor_id').eq('id', parentId).maybeSingle()
  if (!p) return { error: '상위 조직을 찾을 수 없습니다.' }
  if (!unit.trim()) return { error: '조직 이름(팀명)을 입력하세요.' }
  const { nodes, groupName } = await loadOrgNodes(admin, (p.group_id as string | null) ?? null)
  const { byId } = indexNodes(nodes)
  const parent = byId.get(parentId)
  if (!parent) return { error: '상위 조직은 같은 업체의 활성 매출처여야 합니다.' }
  if (ancestorsOf(parentId, byId).length + 2 > ORG_MAX_DEPTH) return { error: `조직은 업체 아래 ${ORG_MAX_DEPTH}단계까지 만들 수 있습니다.` }
  const gName = p.group_id ? groupName.get(p.group_id as string) ?? null : null
  const name = suggestChildName(gName, parent, byId, unit)
  const dup = await findVendorByFullName(admin, name)
  if (dup) return { error: `같은 이름의 매출처가 이미 있습니다: ${dup.name} — "기존 매출처 편입"으로 연결하세요.`, existing: { id: dup.id, name: dup.name } }
  const { data, error } = await admin.from('vendors').insert({
    name, type: 'customer', group_id: p.group_id, is_active: true, parent_vendor_id: parentId, location_vendor_id: locationId,
  }).select('id').single()
  if (error) return { error: isMissing120(error.message) ? '하위 조직 기능이 아직 적용되지 않았습니다(마이그레이션 120).' : error.message }
  await admin.from('vendor_org_changes').insert({ vendor_id: data.id, field: 'parent', new_vendor_id: parentId, new_name: p.name, changed_by: actor.id, changed_by_name: actor.name })
  return { ok: true, vendor_id: data.id as string, name }
}

// 기존 매출처를 하위로 편입할 때 제안하는 새 이름 (규칙에 맞지 않을 때만)
export async function suggestRenameForParent(admin: SupabaseClient, childId: string, parentId: string | null): Promise<string | null> {
  const { data: c } = await admin.from('vendors').select('id, name, group_id').eq('id', childId).maybeSingle()
  if (!c) return null
  const { nodes, groupName } = await loadOrgNodes(admin, (c.group_id as string | null) ?? null)
  const { byId } = indexNodes(nodes)
  const gName = c.group_id ? groupName.get(c.group_id as string) ?? null : null
  const parent = parentId ? byId.get(parentId) ?? null : null
  // 지금 이름에서 업체명 · 옛 상위 이름을 뗀 단위 이름
  const self = byId.get(childId) ?? { ...(c as OrgNode), parent_vendor_id: null, location_vendor_id: null, is_active: true }
  const unit = unitName(self, byId, gName)
  const want = suggestChildName(gName, parent, byId, unit)
  return norm(want) === norm(c.name as string) ? null : want
}
