import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { groupKey, standardizeVendorInput, type VendorNameInput } from '@/lib/vendor-group-names'

// ─────────────────────────────────────────────────────────
// 매출처 등록 입력 확인 (2026-11-19, 업체명 자동 표준화 — lib/vendor-group-names.ts)
// 표준화한 이름으로 기존 업체 · 기존 매출처(이름 · 옛 이름 별칭)를 찾는다.
// 쓰는 곳: 매출처 등록 창(/api/vendor-hub/name-check) · 주문 입력 · 상담일지(/api/orders-portal/masters?name_check=1)
//         · 등록 API 3곳(저장 직전 같은 판정).
// ─────────────────────────────────────────────────────────

// 매출처 이름 비교 키 — 법인 표기 · 공백 · 대소문자 무시 (매출처 등록 API의 중복 검사와 같은 규칙)
export const vendorKey = (s: string) => s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '').replace(/\s+/g, '').toLowerCase()

export interface ExistingVendor { id: string; name: string; group_id: string | null; is_active: boolean; via_alias: string | null }

// 병합되지 않은 매출처 중 이름이 같은 것 → 없으면 옛 이름(별칭)이 같은 것. 활성 우선.
export async function findVendorByFullName(admin: SupabaseClient, fullName: string): Promise<ExistingVendor | null> {
  const key = vendorKey(fullName)
  if (!key) return null
  const r = await fetchAllRows<{ id: string; name: string; group_id: string | null; is_active: boolean | null; match_aliases: string[] | null; type: string | null }>((f, t) =>
    admin.from('vendors').select('id, name, group_id, is_active, match_aliases, type').neq('status', 'merged').range(f, t))
  if ('error' in r) return null
  const rows = r.data.filter(v => v.type !== 'vendor')
  const rank = (v: { is_active: boolean | null }) => (v.is_active === false ? 1 : 0)
  const byName = rows.filter(v => vendorKey(v.name) === key).sort((a, b) => rank(a) - rank(b))[0]
  if (byName) return { id: byName.id, name: byName.name, group_id: byName.group_id, is_active: byName.is_active !== false, via_alias: null }
  for (const v of rows.sort((a, b) => rank(a) - rank(b))) {
    const a = (v.match_aliases ?? []).find(x => vendorKey(x) === key)
    if (a) return { id: v.id, name: v.name, group_id: v.group_id, is_active: v.is_active !== false, via_alias: a }
  }
  return null
}

// 표준 업체명과 같은 업체 (법인 표기 · 공백 무시)
export async function findGroupByName(admin: SupabaseClient, name: string): Promise<{ id: string; name: string } | null> {
  const k = groupKey(name)
  if (!k) return null
  const r = await fetchAllRows<{ id: string; name: string }>((f, t) => admin.from('vendor_groups').select('id, name').range(f, t))
  if ('error' in r) return null
  return r.data.find(g => groupKey(g.name) === k) ?? null
}

export interface NameCheckResult {
  input: VendorNameInput
  group: { id: string; name: string; branch_count: number } | null   // 연결될 기존 업체 (없으면 새 업체)
  existing: ExistingVendor | null                                      // 이미 있는 매출처 (있으면 새로 만들지 않음)
}

export async function checkVendorName(admin: SupabaseClient, groupTyped: string, branchTyped: string, groupId?: string | null): Promise<NameCheckResult> {
  let fixed: { id: string; name: string } | null = null
  if (groupId) {
    const { data } = await admin.from('vendor_groups').select('id, name').eq('id', groupId).maybeSingle()
    if (data) fixed = { id: data.id as string, name: data.name as string }
  }
  const input = standardizeVendorInput(groupTyped, branchTyped, fixed?.name ?? null)
  const [g, existing] = await Promise.all([
    fixed ? Promise.resolve(fixed) : findGroupByName(admin, input.group.name),
    input.fullName ? findVendorByFullName(admin, input.fullName) : Promise.resolve(null),
  ])
  let group: NameCheckResult['group'] = null
  if (g) {
    const { count } = await admin.from('vendors').select('id', { count: 'exact', head: true }).eq('group_id', g.id).neq('status', 'merged')
    group = { id: g.id, name: g.name, branch_count: count ?? 0 }
  }
  return { input, group, existing }
}
