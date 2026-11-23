// ─────────────────────────────────────────────────────────
// 은행 점포 목록(은행연합회 점포 현황) — 121, 2026-11-23 사용자 승인 (시안 docs/mockups/은행점포_목록_시안.html, B안)
//  - 점포 목록은 매출처와 별도의 원본 표(bank_branches, 기준월별). 매출처는 쓸 때 만든다(주문 · 상담 · 등록 창 · 매출처 관리 "은행 점포").
//  - 이름 규칙(2026-11-19 · 11-23 결정): 꼬리 없는 점포명은 '지점'을 붙이고, (점) → 지점, (출) → 출장소. 매출처 이름 = 업체명 + 지점명.
//  - 미등록 점포를 고르면 주문 입력자 누구나 매출처로 등록(아르바이트 제외 — 신규 거래처 등록 차단 규칙 그대로).
//  - 121 미적용이면 모든 함수가 조용히 빈 결과를 돌려준다(화면에서 기능이 숨는다).
// ─────────────────────────────────────────────────────────
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// 은행연합회 표기 → 이 시스템 업체명. 없으면 은행연합회 표기 그대로.
export const BANK_GROUP_MAP: Record<string, string> = {
  'iM뱅크(구 대구은행)': 'iM뱅크',
  'Sh수협은행': '수협은행',       // 이미 쓰던 업체명
}
export const bankGroupName = (bank: string) => BANK_GROUP_MAP[bank.trim()] ?? bank.trim()

// 은행연합회 점포명 → 매출처 이름에 쓸 지점명
export function branchDisplayName(raw: string): string {
  let b = raw.trim().replace(/\s+/g, ' ').replace(/\(점\)$/, '지점').replace(/\(출\)$/, '출장소')
  if (!/(지점|출장소|센터|영업부|본부|부|점)$/.test(b.replace(/\s+/g, ''))) b += '지점'
  return b
}

// 점포 · 지점 이름 비교 키 — 공백 · 대소문자 무시, 꼬리 '지점'만 뗀다('강남' ≠ '강남금융센터')
export function branchKey(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase().replace(/\(점\)$/, '').replace(/\(출\)$/, '출장소').replace(/지점$/, '')
}

export interface BankBranch {
  id: string; base_month: string; bank_name: string; group_name: string; branch_name: string; display_name: string
  sido: string | null; sigungu: string | null; dong: string | null; address: string | null; phone: string | null
  vendor_id: string | null
}
const COLS = 'id, base_month, bank_name, group_name, branch_name, display_name, sido, sigungu, dong, address, phone, vendor_id'

export const fullNameOf = (b: Pick<BankBranch, 'group_name' | 'display_name'>) => `${b.group_name} ${b.display_name}`

// 현재 기준월 점포 전부 (5천여 행 — 페이지로 읽는다). 표가 없으면 null.
export async function loadCurrentBranches(admin: SupabaseClient): Promise<BankBranch[] | null> {
  const r = await fetchAllRows<BankBranch>((f, t) => admin.from('bank_branches').select(COLS).eq('is_current', true).order('id').range(f, t))
  if ('error' in r) return null
  return r.data
}

const qKey = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const matchQ = (b: BankBranch, q: string) => {
  const k = qKey(q)
  if (!k) return true
  return [b.display_name, b.branch_name, b.sigungu ?? '', b.dong ?? '', b.address ?? '', b.phone ?? '', fullNameOf(b)].some(x => qKey(x).includes(k))
}

// ── 매출처 관리 "은행 점포" 보기 ─────────────────────────
export interface BranchListRow extends BankBranch {
  vendor_name: string | null; vendor_active: boolean | null; staff: string | null
}
export interface BranchListResult {
  available: boolean
  base_month: string | null
  kpi: { total: number; linked: number; unlinked: number; missing: number }
  banks: { group_name: string; total: number; unlinked: number }[]
  sidos: string[]
  sigungus: string[]
  rows: BranchListRow[]
  row_total: number
  missing_rows?: { id: string; name: string; group_name: string }[]
}

export async function listBankBranches(admin: SupabaseClient, f: {
  group?: string | null; sido?: string | null; sigungu?: string | null; q?: string | null
  status?: 'all' | 'unlinked' | 'linked' | 'missing'; limit?: number; offset?: number
}): Promise<BranchListResult> {
  const empty: BranchListResult = { available: false, base_month: null, kpi: { total: 0, linked: 0, unlinked: 0, missing: 0 }, banks: [], sidos: [], sigungus: [], rows: [], row_total: 0 }
  const all = await loadCurrentBranches(admin)
  if (!all) return empty
  const linkedIds = new Set(all.map(b => b.vendor_id).filter((x): x is string => !!x))
  // 점포 목록에 없는 은행 매출처: 점포 표에 있는 은행 업체의 활성 매출처 중 연결된 점포가 없고 '점포 아님'도 아닌 곳
  const bankGroups = Array.from(new Set(all.map(b => b.group_name)))
  const missing = await missingBankVendors(admin, bankGroups, linkedIds)

  const banks = new Map<string, { total: number; unlinked: number }>()
  for (const b of all) { const x = banks.get(b.group_name) ?? { total: 0, unlinked: 0 }; x.total++; if (!b.vendor_id) x.unlinked++; banks.set(b.group_name, x) }

  let rows = all
  if (f.group) rows = rows.filter(b => b.group_name === f.group)
  const sidos = Array.from(new Set(rows.map(b => b.sido).filter((x): x is string => !!x))).sort()
  if (f.sido) rows = rows.filter(b => b.sido === f.sido)
  const sigungus = f.sido ? Array.from(new Set(rows.map(b => b.sigungu).filter((x): x is string => !!x))).sort() : []
  if (f.sigungu) rows = rows.filter(b => b.sigungu === f.sigungu)
  if (f.q) rows = rows.filter(b => matchQ(b, f.q!))
  if (f.status === 'unlinked') rows = rows.filter(b => !b.vendor_id)
  if (f.status === 'linked') rows = rows.filter(b => !!b.vendor_id)
  rows = rows.slice().sort((a, b) => Number(!!a.vendor_id) - Number(!!b.vendor_id) || a.group_name.localeCompare(b.group_name, 'ko') || a.display_name.localeCompare(b.display_name, 'ko'))

  const off = f.offset ?? 0, lim = f.limit ?? 100
  const page = rows.slice(off, off + lim)
  const vIds = Array.from(new Set(page.map(b => b.vendor_id).filter((x): x is string => !!x)))
  const vInfo = new Map<string, { name: string; is_active: boolean }>()
  const staff = new Map<string, string>()
  for (let i = 0; i < vIds.length; i += 150) {
    const c = vIds.slice(i, i + 150)
    const [{ data: vs }, { data: st }] = await Promise.all([
      admin.from('vendors').select('id, name, is_active').in('id', c),
      admin.from('vendor_staff').select('vendor_id, is_primary, employees(name)').in('vendor_id', c).is('ended_at', null),
    ])
    for (const v of vs ?? []) vInfo.set(v.id as string, { name: v.name as string, is_active: v.is_active !== false })
    for (const s of st ?? []) { const n = (s.employees as { name?: string } | null)?.name; if (n && (s.is_primary || !staff.has(s.vendor_id as string))) staff.set(s.vendor_id as string, n) }
  }
  return {
    available: true,
    base_month: all[0]?.base_month ?? null,
    kpi: { total: all.length, linked: all.filter(b => b.vendor_id).length, unlinked: all.filter(b => !b.vendor_id).length, missing: missing.length },
    banks: Array.from(banks.entries()).map(([group_name, x]) => ({ group_name, ...x })).sort((a, b) => b.total - a.total),
    sidos, sigungus,
    rows: page.map(b => ({ ...b, vendor_name: b.vendor_id ? vInfo.get(b.vendor_id)?.name ?? null : null, vendor_active: b.vendor_id ? vInfo.get(b.vendor_id)?.is_active ?? null : null, staff: b.vendor_id ? staff.get(b.vendor_id) ?? null : null })),
    row_total: rows.length,
    missing_rows: f.status === 'missing' ? missing.filter(m => !f.group || m.group_name === f.group).filter(m => !f.q || qKey(m.name).includes(qKey(f.q))) : undefined,
  }
}

async function missingBankVendors(admin: SupabaseClient, bankGroups: string[], linkedIds: Set<string>) {
  if (!bankGroups.length) return []
  const { data: gs } = await admin.from('vendor_groups').select('id, name').in('name', bankGroups)
  const gName = new Map((gs ?? []).map(g => [g.id as string, g.name as string]))
  if (!gName.size) return []
  const r = await fetchAllRows<{ id: string; name: string; group_id: string; not_bank_branch: boolean | null; parent_vendor_id: string | null }>((f, t) =>
    admin.from('vendors').select('id, name, group_id, not_bank_branch, parent_vendor_id').in('group_id', Array.from(gName.keys()))
      .neq('status', 'merged').eq('is_active', true).order('id').range(f, t))
  if ('error' in r) return []
  return r.data
    // 점포처럼 보이는 이름(지점 · 출장소 · 센터 · …점)만 — 본점 부서 · 팀 · 하위 조직 · 모임은 대상이 아니다
    .filter(v => !linkedIds.has(v.id) && !v.not_bank_branch && !v.parent_vendor_id && /(지점|출장소|센터|점)$/.test(v.name) && !/본점$/.test(v.name))
    .map(v => ({ id: v.id, name: v.name, group_name: gName.get(v.group_id)! }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

// ── 주문 · 상담 · 등록 창 검색 — 미등록 점포 (매출처 결과 아래, 최대 limit) ──
export interface BranchHit { id: string; group_name: string; display_name: string; full_name: string; address: string | null; phone: string | null }
export async function searchUnlinkedBranches(admin: SupabaseClient, q: string, groupName: string | null, limit = 5): Promise<BranchHit[]> {
  const k = qKey(q)
  if (k.length < 1) return []
  let query = admin.from('bank_branches').select(COLS).eq('is_current', true).is('vendor_id', null).limit(300)
  if (groupName) query = query.eq('group_name', groupName)
  // 표 쪽에서 먼저 좁힌다 — 점포명 · 시군구 · 동 · 주소 중 하나에 검색어(공백 무시는 아래에서 다시 확인)
  // 업체를 안 골랐을 때 '광주은행 상무'처럼 은행명까지 치면 마지막 낱말로 좁히고, 아래 matchQ가 전체 이름(은행 + 지점)으로 확인한다
  const words = q.trim().split(/\s+/)
  const like = `%${(words[words.length - 1] ?? '').replace(/[%_,()"]/g, '')}%`
  query = query.or(`display_name.ilike.${like},branch_name.ilike.${like},sigungu.ilike.${like},dong.ilike.${like},address.ilike.${like}`)
  const { data, error } = await query
  if (error) return []
  return ((data ?? []) as BankBranch[])
    .filter(b => matchQ(b, q))
    .sort((a, b) => Number(!qKey(a.display_name).startsWith(k)) - Number(!qKey(b.display_name).startsWith(k)) || a.display_name.localeCompare(b.display_name, 'ko'))
    .slice(0, limit)
    .map(b => ({ id: b.id, group_name: b.group_name, display_name: b.display_name, full_name: fullNameOf(b), address: b.address, phone: b.phone }))
}

// ── 점포 → 매출처 (등록 또는 기존 매출처 연결) ─────────────
export async function registerBranch(admin: SupabaseClient, branchId: string, actor: string):
  Promise<{ vendor_id: string; group_id: string | null; name: string; existed: boolean } | { error: string }> {
  const { data: b, error } = await admin.from('bank_branches').select(COLS).eq('id', branchId).maybeSingle()
  if (error || !b) return { error: '점포를 찾을 수 없습니다.' }
  const br = b as BankBranch
  const link = async (vendorId: string) => {
    await admin.from('bank_branches').update({ vendor_id: vendorId, linked_by: actor, linked_at: new Date().toISOString() }).eq('id', br.id).is('vendor_id', null)
  }
  if (br.vendor_id) {
    const { data: v } = await admin.from('vendors').select('id, name, group_id').eq('id', br.vendor_id).maybeSingle()
    if (v) return { vendor_id: v.id as string, group_id: (v.group_id as string | null) ?? null, name: v.name as string, existed: true }
  }
  // 업체(없으면 만든다)
  let groupId: string | null = null
  {
    const g = await admin.from('vendor_groups').select('id').eq('name', br.group_name).maybeSingle()
    if (g.data) groupId = g.data.id as string
    else { const ins = await admin.from('vendor_groups').insert({ name: br.group_name }).select('id').single(); if (!ins.error) groupId = ins.data.id as string }
  }
  const name = fullNameOf(br)
  // 같은 업체 안 같은 지점(이름 · 옛 이름 별칭)이 이미 있으면 그 매출처를 쓴다 — 비활성이면 다시 활성
  if (groupId) {
    const { data: same } = await admin.from('vendors').select('id, name, is_active, match_aliases').eq('group_id', groupId).neq('status', 'merged')
    const k = branchKey(br.display_name)
    const hit = (same ?? []).filter(v => [v.name as string, ...((v.match_aliases as string[] | null) ?? [])]
      .some(n => n.startsWith(br.group_name + ' ') && branchKey(n.slice(br.group_name.length)) === k))
    if (hit.length === 1) {
      const v = hit[0]
      if (v.is_active === false) await admin.from('vendors').update({ is_active: true }).eq('id', v.id)
      await link(v.id as string)
      return { vendor_id: v.id as string, group_id: groupId, name: v.name as string, existed: true }
    }
  }
  const note = `은행연합회 점포(${br.base_month}): ${[br.address, br.phone].filter(Boolean).join(' · ')}`
  const ins = await admin.from('vendors').insert({ name, type: 'customer', is_active: true, group_id: groupId, note }).select('id').single()
  if (ins.error) return { error: `매출처 등록 실패: ${ins.error.message}` }
  await link(ins.data.id as string)
  return { vendor_id: ins.data.id as string, group_id: groupId, name, existed: false }
}

// ── 매출처 상세 — 점포 정보 ────────────────────────────
export interface VendorBranchInfo {
  available: boolean
  branch: BankBranch | null
  is_bank: boolean              // 점포 표에 있는 은행 업체의 매출처
  not_branch: boolean           // '점포 아님' 표시됨
  suggestions: BankBranch[]     // 연결이 없을 때 비슷한 미연결 점포
}
export async function vendorBranchInfo(admin: SupabaseClient, vendorId: string): Promise<VendorBranchInfo> {
  const none: VendorBranchInfo = { available: false, branch: null, is_bank: false, not_branch: false, suggestions: [] }
  const { data: linked, error } = await admin.from('bank_branches').select(COLS).eq('vendor_id', vendorId).eq('is_current', true).limit(1)
  if (error) return none
  if (linked?.length) return { available: true, branch: linked[0] as BankBranch, is_bank: true, not_branch: false, suggestions: [] }
  const { data: v } = await admin.from('vendors').select('name, not_bank_branch, vendor_groups(name)').eq('id', vendorId).maybeSingle()
  const g = (v?.vendor_groups as { name?: string } | null)?.name ?? null
  if (!v || !g) return { ...none, available: true }
  const { count } = await admin.from('bank_branches').select('id', { count: 'exact', head: true }).eq('group_name', g).eq('is_current', true)
  if (!count) return { ...none, available: true }
  const branchPart = (v.name as string).startsWith(g + ' ') ? (v.name as string).slice(g.length).trim() : ''
  const loose = branchKey(branchPart).replace(/(종합금융센터|금융센터|pb센터|wm센터|센터|출장소)$/, '')
  let suggestions: BankBranch[] = []
  if (loose.length >= 2) {
    const { data } = await admin.from('bank_branches').select(COLS).eq('group_name', g).eq('is_current', true).is('vendor_id', null)
      .ilike('branch_name', `%${loose.slice(0, 2)}%`).limit(50)
    suggestions = ((data ?? []) as BankBranch[]).filter(b => branchKey(b.branch_name).includes(loose) || loose.includes(branchKey(b.branch_name))).slice(0, 4)
  }
  return { available: true, branch: null, is_bank: true, not_branch: !!v.not_bank_branch, suggestions }
}

export async function linkBranchToVendor(admin: SupabaseClient, branchId: string, vendorId: string | null, actor: string): Promise<{ ok: true } | { error: string }> {
  if (vendorId) {
    const { data: other } = await admin.from('bank_branches').select('id').eq('vendor_id', vendorId).eq('is_current', true).neq('id', branchId).limit(1)
    if (other?.length) return { error: '이 매출처는 이미 다른 점포에 연결돼 있습니다. 그 연결을 먼저 푸세요.' }
  }
  const { error } = await admin.from('bank_branches').update({ vendor_id: vendorId, linked_by: actor, linked_at: new Date().toISOString() }).eq('id', branchId)
  return error ? { error: error.message } : { ok: true }
}
