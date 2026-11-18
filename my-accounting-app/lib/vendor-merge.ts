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
//
// 병합 취소 (119, 2026-11-18 사용자 승인): 합치기 직전에 흡수되는 쪽의 건별 목록 · 합산 전 값을
// vendor_merge_snapshots 에 남기고(vendor_merge_snapshot), 취소는 그 목록의 건만 원래 매출처로 돌려보낸다
// (unmerge_vendor — DB 함수 한 번 = 한 트랜잭션). 합친 뒤 새로 들어온 건은 남는 쪽에 둔다.
//   - 119 미적용이면 기록 없이 합친다(전과 같음 — 그 병합은 취소할 수 없다).
//   - 합치기가 도중에 실패하면 그때까지 옮긴 것을 같은 함수로 되돌린다.
//   - 119 이전 병합 · 합치면서 같이 한 담당자(인물) 병합은 취소 대상이 아니다.
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
export async function executeVendorMerge(admin: SupabaseClient, fromId: string, intoId: string, actor: string | null): Promise<{ ok: true; moved: Record<string, unknown>; undoable: boolean } | { error: string }> {
  const pv = await previewVendorMerge(admin, fromId, intoId)
  if ('error' in pv) return pv
  if (pv.blockers.length) return { error: pv.blockers.join(' ') }

  // 0) 병합 취소용 기록 (119). 지난번에 도중 실패해 남은 기록이 있으면 먼저 되돌려 놓고 새로 찍는다.
  let snapId: string | null = null
  {
    const { data: stale, error: stErr } = await admin.from('vendor_merge_snapshots').select('id')
      .eq('from_id', fromId).is('completed_at', null).is('undone_at', null)
    if (!stErr) for (const st of stale ?? []) await admin.rpc('unmerge_vendor', { p_snapshot: st.id, p_actor: '자동(이전 실패 정리)' })
    const sn = await admin.rpc('vendor_merge_snapshot', { p_from: fromId, p_into: intoId, p_actor: actor })
    if (sn.error) {
      if (!isMissing119(sn.error)) return { error: `병합 준비 실패(취소용 기록): ${sn.error.message}` }
    } else snapId = sn.data as string
  }
  // 도중 실패 → 옮기던 것을 되돌린다
  const fail = async (msg: string): Promise<{ error: string }> => {
    if (!snapId) return { error: msg }
    const u = await admin.rpc('unmerge_vendor', { p_snapshot: snapId, p_actor: '자동(병합 실패)' })
    return { error: u.error ? `${msg} — 옮기던 것을 되돌리지 못했습니다(${u.error.message}). ERP 담당자에게 알려 주세요.` : `${msg} — 옮기던 것은 원래대로 되돌렸습니다.` }
  }

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
    if (error && !/does not exist|relation|schema cache/i.test(error.message)) return fail(`${t} 이전 실패: ${error.message}`)
    if (data?.length) moved[t] = data.length
  }
  // 3) 배정 · 지점 담당 · 영업일지 · 주문 · 발주 → 4) 회계 연결 · 별칭 · 병합 표시 · 이력
  const x = await admin.rpc('merge_vendor_extra_refs', { p_from: fromId, p_into: intoId })
  if (x.error) return fail(`병합 실패(고객 연결): ${x.error.message}`)
  const m = await admin.rpc('merge_vendor', { p_from: fromId, p_into: intoId, p_actor: actor })
  if (m.error) return fail(`병합 실패: ${m.error.message}`)
  if (snapId) {
    const { data: lg } = await admin.from('vendor_merge_logs').select('id')
      .eq('kind', 'vendor').eq('from_id', fromId).eq('into_id', intoId).order('merged_at', { ascending: false }).limit(1)
    await admin.from('vendor_merge_snapshots').update({ completed_at: new Date().toISOString(), log_id: lg?.[0]?.id ?? null }).eq('id', snapId)
  }

  // 5) 남는 쪽 별칭에서 공용 이름(업체명과 같은 이름 — 예: '개인')은 뺀다. 남겨 두면 그 표기가 이 매출처로 잡힌다.
  if (pv.into.group_name) {
    const { data: v } = await admin.from('vendors').select('match_aliases').eq('id', intoId).maybeSingle()
    const al = ((v?.match_aliases as string[] | null) ?? [])
    const kept = al.filter(a => normName(a) !== normName(pv.into.group_name!))
    if (kept.length !== al.length) await admin.from('vendors').update({ match_aliases: kept }).eq('id', intoId)
  }
  return { ok: true, undoable: !!snapId, moved: { ...moved, ...((x.data as Record<string, unknown>) ?? {}), ...((m.data as Record<string, unknown>) ?? {}) } }
}

// ── 병합 이력 · 병합 취소 (119) ─────────────────────────
const isMissing119 = (e: { message?: string; code?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || e.code === 'PGRST205'
    || /vendor_merge_snapshot|unmerge_vendor|schema cache|does not exist/i.test(e.message ?? ''))

export interface MergeHistoryRow {
  log_id: string
  merged_at: string
  actor: string | null
  from_id: string
  from_name: string
  moved_total: number
  snapshot_id: string | null        // 있으면 건별 기록이 있는 병합
  undone_at: string | null
  undone_by: string | null
  can_undo: boolean
  why_not: string | null
}

// 이 매출처로 합쳐진 병합 목록 (최근 것부터)
export async function listMergeHistory(admin: SupabaseClient, vendorId: string): Promise<MergeHistoryRow[]> {
  const { data: logs } = await admin.from('vendor_merge_logs')
    .select('id, merged_at, actor, from_id, from_name, moved_refs').eq('kind', 'vendor').eq('into_id', vendorId)
    .order('merged_at', { ascending: false }).limit(100)
  if (!logs?.length) return []
  const { data: snaps, error } = await admin.from('vendor_merge_snapshots')
    .select('id, log_id, from_id, created_at, completed_at, undone_at, undone_by').eq('into_id', vendorId).not('completed_at', 'is', null)
  const byLog = new Map<string, { id: string; undone_at: string | null; undone_by: string | null }>()
  if (!error) for (const sn of snaps ?? []) {
    if (sn.log_id) byLog.set(sn.log_id as string, { id: sn.id as string, undone_at: (sn.undone_at as string | null) ?? null, undone_by: (sn.undone_by as string | null) ?? null })
  }
  // 흡수된 쪽의 지금 상태 — 아직 이 매출처에 병합돼 있어야 취소할 수 있다
  const fromIds = Array.from(new Set(logs.map(l => l.from_id as string)))
  const cur = new Map<string, { status: string; merged_into_id: string | null }>()
  for (let k = 0; k < fromIds.length; k += 100) {
    const { data } = await admin.from('vendors').select('id, status, merged_into_id').in('id', fromIds.slice(k, k + 100))
    for (const v of data ?? []) cur.set(v.id as string, { status: v.status as string, merged_into_id: (v.merged_into_id as string | null) ?? null })
  }
  return logs.map(l => {
    const sn = byLog.get(l.id as string) ?? null
    const c = cur.get(l.from_id as string)
    const refs = (l.moved_refs ?? {}) as Record<string, unknown>
    const moved_total = Object.entries(refs).reduce((a, [k, v]) => a + (k !== 'opening_balance_moved' && typeof v === 'number' ? v : 0), 0)
    let why: string | null = null
    if (!sn) why = '건별 기록이 없는 병합입니다(병합 취소 기능 이전) — 화면에서 취소할 수 없습니다.'
    else if (sn.undone_at) why = '이미 취소했습니다.'
    else if (!c || c.status !== 'merged' || c.merged_into_id !== vendorId) why = '흡수된 매출처의 상태가 그 뒤 바뀌었습니다.'
    return {
      log_id: l.id as string, merged_at: l.merged_at as string, actor: (l.actor as string | null) ?? null,
      from_id: l.from_id as string, from_name: l.from_name as string, moved_total,
      snapshot_id: sn?.id ?? null, undone_at: sn?.undone_at ?? null, undone_by: sn?.undone_by ?? null,
      can_undo: !why, why_not: why,
    }
  })
}

// 표 이름 → 화면 표기 (REF_TABLES 와 같은 말)
const UNDO_LABELS: Record<string, string> = {
  ...Object.fromEntries(REF_TABLES.filter(t => !t.col).map(t => [t.table, t.label])),
  card_accounts: '카드 계좌', purchase_cycle_reviews: '매입 정산 확인', contact_review_events: '담당자 확인 이력',
}
const UNDO_ORDER = REF_TABLES.filter(t => !t.col).map(t => t.table)

export interface UnmergePreview {
  snapshot_id: string
  from_id: string; from_name: string
  into_id: string; into_name: string
  actor: string | null
  created_at: string
  blockers: string[]
  counts: { table: string; label: string; total: number; back: number }[]   // total = 병합 때 옮긴 건, back = 지금 돌아갈 건
  staff_restore: number
  aliases_remove: string[]
  opening_from: number | null
  purchase_opening_from: number | null
  billing_children: number
}

export async function previewVendorUnmerge(admin: SupabaseClient, snapshotId: string): Promise<UnmergePreview | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) return { error: '병합 기록을 찾을 수 없습니다.' }
  const { data, error } = await admin.rpc('unmerge_vendor_preview', { p_snapshot: snapshotId })
  if (error) return { error: isMissing119(error) ? '병합 취소 기능이 아직 적용되지 않았습니다(마이그레이션 119).' : error.message }
  const d = (data ?? {}) as Record<string, unknown>
  if (!d.snapshot_id) return { error: ((d.blockers as string[] | undefined) ?? ['병합 기록을 찾을 수 없습니다.']).join(' ') }
  const tables = (d.tables ?? {}) as Record<string, { total: number; back: number }>
  const counts = Object.entries(tables)
    .map(([table, v]) => ({ table, label: UNDO_LABELS[table] ?? table, total: v.total, back: v.back }))
    .sort((a, b) => (UNDO_ORDER.indexOf(a.table) + 100) % 100 - (UNDO_ORDER.indexOf(b.table) + 100) % 100)
  return {
    snapshot_id: d.snapshot_id as string,
    from_id: d.from_id as string, from_name: d.from_name as string,
    into_id: d.into_id as string, into_name: d.into_name as string,
    actor: (d.actor as string | null) ?? null, created_at: d.created_at as string,
    blockers: (d.blockers as string[] | null) ?? [],
    counts,
    staff_restore: Number(d.staff_restore ?? 0),
    aliases_remove: (d.aliases_remove as string[] | null) ?? [],
    opening_from: d.opening_from == null ? null : Number(d.opening_from),
    purchase_opening_from: d.purchase_opening_from == null ? null : Number(d.purchase_opening_from),
    billing_children: Number(d.billing_children ?? 0),
  }
}

// 병합 취소 실행 — DB 함수 한 번(한 트랜잭션). 막는 이유가 있으면 함수가 거절한다.
export async function executeVendorUnmerge(admin: SupabaseClient, snapshotId: string, actor: string | null): Promise<{ ok: true; result: Record<string, unknown> } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) return { error: '병합 기록을 찾을 수 없습니다.' }
  const { data, error } = await admin.rpc('unmerge_vendor', { p_snapshot: snapshotId, p_actor: actor })
  if (error) return { error: isMissing119(error) && !/취소|병합|매출처/.test(error.message) ? '병합 취소 기능이 아직 적용되지 않았습니다(마이그레이션 119).' : `병합 취소 실패: ${error.message}` }
  return { ok: true, result: (data ?? {}) as Record<string, unknown> }
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
