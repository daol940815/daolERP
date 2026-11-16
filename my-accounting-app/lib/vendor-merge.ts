import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────
// 매출처 합치기 (전체 병합) — 2026-11-16 사용자 승인 (시안 docs/mockups/매출처_합치기_시안.html)
//
// 같은 지점이 두 매출처로 나뉜 것을 하나로 합친다. 기존 merge_vendor(055)는 회계 쪽 연결
// (통장 · 계산서 · 카드 · ERP 별칭 · 원장 · 기초잔액)만, merge_vendor_extra_refs(413)는 배정 · 지점 담당 ·
// 영업일지 · 주문 주문처 · 발주를 옮긴다. 여기서는 그 둘이 다루지 않는 고객 쪽 데이터(상담일지 · 표기 연결 ·
// 과거 매출 스냅샷 · 확인 대기 이력)를 먼저 옮기고, 대표 담당자 충돌을 정리한 뒤 두 함수를 부른다.
//   - 흡수된 쪽: status merged, 이름은 남는 쪽 별칭(match_aliases) — 이후 같은 이름도 남는 쪽으로.
//   - 청구처(114) · 개인 고객(115) 연결은 DB 트리거가 남는 쪽으로 승계.
//   - 사업자번호가 다르면 경고만(사용자 결정 — 막지 않음). 개인 고객 두 명의 매출처는 막는다(인물 병합으로).
// 화면: 매출처 상세 "다른 매출처와 합치기", 회계·재무 › 거래처 중복 정리(같은 함수).
// ─────────────────────────────────────────────────────────

export interface MergeCount { key: string; label: string; from: number; into: number }
export interface MergePreview {
  from: { id: string; name: string; group_name: string | null; biz_number: string | null; is_active: boolean; created_at: string }
  into: { id: string; name: string; group_name: string | null; biz_number: string | null; is_active: boolean; created_at: string }
  counts: MergeCount[]
  warnings: string[]
  blockers: string[]
  same_name: { name: string; contacts: { contact_id: string; code: string | null; vendor_side: 'from' | 'into' }[] }[]
}

// 매출처를 가리키는 표 — 미리보기 건수 (없는 표는 0)
const REF_TABLES: { key: string; label: string; table: string; col?: string }[] = [
  { key: 'orders', label: '주문', table: 'erp_orders' },
  { key: 'consultations', label: '상담일지', table: 'erp_consultations' },
  { key: 'assignments', label: '거래처 담당자 배정', table: 'contact_assignments' },
  { key: 'staff', label: '지점 담당(다올)', table: 'vendor_staff' },
  { key: 'activities', label: '영업일지', table: 'contact_activities' },
  { key: 'tax_invoices', label: '계산서', table: 'tax_invoices' },
  { key: 'transactions', label: '통장 거래', table: 'transactions' },
  { key: 'card_sales', label: '카드매출', table: 'card_sales' },
  { key: 'cash_receipts', label: '현금영수증', table: 'cash_receipts' },
  { key: 'journal_lines', label: '분개 라인', table: 'journal_lines' },
  { key: 'ledger', label: '거래처 원장', table: 'vendor_ledger_entries' },
  { key: 'aliases', label: 'ERP 별칭', table: 'erp_vendor_aliases' },
  { key: 'name_links', label: '담당자 표기 연결', table: 'contact_name_links' },
  { key: 'snapshot', label: '과거 매출 스냅샷', table: 'doc_sales_snapshot' },
  { key: 'purchase_orders', label: '발주서', table: 'erp_purchase_orders' },
  { key: 'billing_children', label: '청구처 소속 부서', table: 'vendors', col: 'billing_vendor_id' },
]

async function countRefs(admin: SupabaseClient, vendorId: string) {
  const out = new Map<string, number>()
  await Promise.all(REF_TABLES.map(async t => {
    const { count, error } = await admin.from(t.table).select(t.col ?? 'vendor_id', { count: 'exact', head: true }).eq(t.col ?? 'vendor_id', vendorId)
    out.set(t.key, error ? 0 : (count ?? 0))
  }))
  return out
}

const normName = (s: string) => s.replace(/\s+/g, '').toLowerCase()

async function loadVendor(admin: SupabaseClient, id: string) {
  const { data } = await admin.from('vendors')
    .select('id, name, biz_number, is_active, status, created_at, group_id, vendor_groups(name)').eq('id', id).maybeSingle()
  if (!data) return null
  // 개인 고객(115) — 미적용이면 없음
  const { data: ind } = await admin.from('vendors').select('individual_contact_id').eq('id', id).maybeSingle()
  return {
    id: data.id as string, name: data.name as string, biz_number: (data.biz_number as string | null) ?? null,
    is_active: data.is_active !== false, status: (data.status as string | null) ?? 'active', created_at: data.created_at as string,
    group_id: (data.group_id as string | null) ?? null,
    group_name: (data.vendor_groups as unknown as { name: string } | null)?.name ?? null,
    individual_contact_id: ((ind as { individual_contact_id?: string | null } | null)?.individual_contact_id) ?? null,
  }
}

export async function previewVendorMerge(admin: SupabaseClient, fromId: string, intoId: string): Promise<MergePreview | { error: string }> {
  if (!fromId || !intoId || fromId === intoId) return { error: '서로 다른 두 매출처를 골라야 합니다.' }
  const [from, into] = await Promise.all([loadVendor(admin, fromId), loadVendor(admin, intoId)])
  if (!from || !into) return { error: '매출처를 찾을 수 없습니다.' }
  const [cf, ci] = await Promise.all([countRefs(admin, fromId), countRefs(admin, intoId)])

  const blockers: string[] = []
  const warnings: string[] = []
  if (from.status === 'merged') blockers.push(`'${from.name}'은(는) 이미 다른 매출처에 병합되어 있습니다.`)
  if (into.status === 'merged') blockers.push(`남길 매출처 '${into.name}'은(는) 이미 병합된 매출처입니다.`)
  if (!into.is_active) blockers.push(`남길 매출처 '${into.name}'이(가) 비활성입니다 — 먼저 재활성하거나 반대쪽을 남기세요.`)
  if (from.individual_contact_id && into.individual_contact_id && from.individual_contact_id !== into.individual_contact_id) {
    blockers.push('서로 다른 개인 고객의 매출처입니다 — 같은 분이면 담당자 관리에서 인물을 먼저 합치세요(매출처는 자동으로 따라옵니다).')
  }
  if (from.group_id !== into.group_id) {
    warnings.push(`업체가 다릅니다: '${from.group_name ?? '없음'}' / '${into.group_name ?? '없음'}' — 남는 쪽 업체 '${into.group_name ?? '없음'}'로 정리됩니다.`)
  }
  const bf = (from.biz_number ?? '').replace(/\D/g, ''), bi = (into.biz_number ?? '').replace(/\D/g, '')
  if (bf && bi && bf !== bi) {
    warnings.push(`사업자번호가 다릅니다: ${from.biz_number} / ${into.biz_number} — 다른 법인이 아닌지 확인하세요. 남는 쪽 번호(${into.biz_number})가 유지됩니다.`)
  }
  if ((cf.get('billing_children') ?? 0) > 0) {
    warnings.push(`'${from.name}'은(는) 청구처 법인입니다(소속 부서 ${cf.get('billing_children')}곳) — 소속 부서는 남는 쪽을 가리키도록 자동으로 옮겨집니다.`)
  }
  if (!from.is_active) warnings.push(`'${from.name}'은(는) 비활성 매출처입니다.`)

  // 같은 이름 담당자 (양쪽 배정 인물 중 이름이 같은데 인물이 다른 경우)
  const { data: asg } = await admin.from('contact_assignments')
    .select('vendor_id, contact_id, contacts(name, code)').in('vendor_id', [fromId, intoId])
  const byName = new Map<string, Map<string, { contact_id: string; code: string | null; vendor_side: 'from' | 'into' }>>()
  for (const a of asg ?? []) {
    const c = a.contacts as unknown as { name: string; code: string | null } | null
    if (!c) continue
    const m = byName.get(c.name) ?? new Map()
    if (!m.has(a.contact_id as string)) m.set(a.contact_id as string, { contact_id: a.contact_id as string, code: c.code ?? null, vendor_side: a.vendor_id === fromId ? 'from' : 'into' })
    byName.set(c.name, m)
  }
  // 이번 합치기로 생기는 것만 — 흡수되는 쪽 인물이 끼어 있는 이름 (남는 쪽에 원래 있던 동명 기록은 제외)
  const same_name = Array.from(byName.entries())
    .filter(([, m]) => m.size > 1 && Array.from(m.values()).some(c => c.vendor_side === 'from'))
    .map(([name, m]) => ({ name, contacts: Array.from(m.values()) }))

  const strip = (v: typeof from) => ({ id: v.id, name: v.name, group_name: v.group_name, biz_number: v.biz_number, is_active: v.is_active, created_at: v.created_at })
  return {
    from: strip(from), into: strip(into),
    counts: REF_TABLES.map(t => ({ key: t.key, label: t.label, from: cf.get(t.key) ?? 0, into: ci.get(t.key) ?? 0 })),
    warnings, blockers, same_name,
  }
}

// 전체 병합 실행. 미리보기의 blockers가 있으면 거절한다.
export async function executeVendorMerge(admin: SupabaseClient, fromId: string, intoId: string, actor: string | null): Promise<{ ok: true; moved: Record<string, unknown> } | { error: string }> {
  const pv = await previewVendorMerge(admin, fromId, intoId)
  if ('error' in pv) return pv
  if (pv.blockers.length) return { error: pv.blockers.join(' ') }

  // 1) 대표 담당자 충돌: 남는 쪽에 현재 대표가 있으면 흡수 쪽 대표 표시를 내린다(유니크 uq_contact_asgn_rep)
  const { data: rep } = await admin.from('contact_assignments').select('id')
    .eq('vendor_id', intoId).eq('is_representative', true).is('ended_at', null).limit(1)
  if (rep?.length) {
    await admin.from('contact_assignments').update({ is_representative: false }).eq('vendor_id', fromId).eq('is_representative', true)
  }
  // 2) 병합 함수가 옮기지 않는 고객 쪽 표 (없는 표는 건너뜀)
  const moved: Record<string, unknown> = {}
  for (const t of ['contact_assignments', 'contact_name_links', 'doc_sales_snapshot', 'erp_consultations', 'contact_review_events']) {
    const { data, error } = await admin.from(t).update({ vendor_id: intoId }).eq('vendor_id', fromId).select('vendor_id')
    if (error && !/does not exist|relation|schema cache/i.test(error.message)) return { error: `${t} 이전 실패: ${error.message}` }
    if (data?.length) moved[t] = data.length
  }
  // 3) 배정 · 지점 담당 · 영업일지 · 주문 · 발주 → 4) 회계 연결 · 별칭 · 병합 표시 · 이력
  const x = await admin.rpc('merge_vendor_extra_refs', { p_from: fromId, p_into: intoId })
  if (x.error) return { error: `병합 실패(고객 연결): ${x.error.message}` }
  const m = await admin.rpc('merge_vendor', { p_from: fromId, p_into: intoId, p_actor: actor })
  if (m.error) return { error: `병합 실패: ${m.error.message}` }

  // 5) 남는 쪽 별칭에서 공용 이름(업체명과 같은 이름 — 예: '개인')은 뺀다. 남겨 두면 그 표기가 이 매출처로 잡힌다.
  if (pv.into.group_name) {
    const { data: v } = await admin.from('vendors').select('match_aliases').eq('id', intoId).maybeSingle()
    const al = ((v?.match_aliases as string[] | null) ?? [])
    const kept = al.filter(a => normName(a) !== normName(pv.into.group_name!))
    if (kept.length !== al.length) await admin.from('vendors').update({ match_aliases: kept }).eq('id', intoId)
  }
  return { ok: true, moved: { ...moved, ...((x.data as Record<string, unknown>) ?? {}), ...((m.data as Record<string, unknown>) ?? {}) } }
}

// 합치기 대상 검색 — 활성 매출처(병합 제외), 이름 · 별칭
export async function searchMergeTargets(admin: SupabaseClient, q: string, excludeId: string) {
  const key = q.trim()
  if (!key) return []
  let query = admin.from('vendors')
    .select('id, name, is_active, created_at, vendor_groups(name)')
    .neq('status', 'merged').in('type', ['customer', 'both'])
    .ilike('name', `%${key.replace(/\s+/g, '%')}%`).order('name').limit(20)
  if (/^[0-9a-f-]{36}$/i.test(excludeId)) query = query.neq('id', excludeId)
  const { data } = await query
  return (data ?? []).map(v => ({
    id: v.id as string, name: v.name as string, is_active: v.is_active !== false, created_at: (v.created_at as string).slice(0, 10),
    group_name: (v.vendor_groups as unknown as { name: string } | null)?.name ?? null,
  }))
}
