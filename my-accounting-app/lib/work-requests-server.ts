// 업무 요청 — 서버(API) 공용: 조회 select · 행 정규화 · 담당자 집계 반영 · 마이그레이션 안내
// (route 파일은 핸들러만 export 해야 하므로 분리). 902 적용 환경 전제 — 미적용이면 안내 문구를 돌려준다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { aggregateStatus, type WrRow, type WrAssignee, type WrTag } from '@/lib/work-requests'

export const MIGRATION_HINT = '900 마이그레이션(업무 요청)이 아직 적용되지 않았습니다. SQL 편집기에서 900_work_requests.sql을 실행해주세요.'
export const MIGRATION_HINT_902 = '902 마이그레이션(담당자 다수 지정)이 아직 적용되지 않았습니다. SQL 편집기에서 902_work_request_assignees.sql을 실행해주세요.'
export const isMissing = (msg: string) => /work_requests|relation .* does not exist/i.test(msg)
export const isMissing902 = (msg: string) => /work_request_assignees|assign_mode/i.test(msg)
// 조회 오류 → 사용자에게 보여줄 문구
export const hintFor = (msg: string) => isMissing904(msg) ? MIGRATION_HINT_904 : isMissing902(msg) ? MIGRATION_HINT_902 : isMissing(msg) ? MIGRATION_HINT : msg

export const ASSIGNEE_SELECT = `id, status, accepted_at, reported_at, rejected_at, reject_reason, last_memo, last_memo_at,
  employee:employees!work_request_assignees_employee_id_fkey(id, name, team)`
export const ROW_SELECT = `id, title, content, link, due_at, is_urgent, status, created_at, accepted_at, reported_at, completed_at,
  canceled_at, rejected_at, reject_reason, last_memo, last_memo_at, is_private, assign_mode,
  requester:employees!work_requests_requester_id_fkey(id, name, team),
  assignee:employees!work_requests_assignee_id_fkey(id, name, team),
  assignees:work_request_assignees(${ASSIGNEE_SELECT})`

// 904 태그 — 적용 전 환경에서는 이 열이 있으면 조회가 실패하므로 selectRows 가 태그 없는 select 로 되돌린다
export const ROW_SELECT_TAGS = `${ROW_SELECT}, tag_links:work_request_tag_links(tag_id)`
export const MIGRATION_HINT_904 = '904 마이그레이션(업무 요청 태그)이 아직 적용되지 않았습니다. SQL 편집기에서 904_work_request_tags.sql을 실행해주세요.'
export const isMissing904 = (msg: string) => /work_request_tags|work_request_tag_links|tags_changed/i.test(msg)

type RawAssignee = Omit<WrAssignee, 'employee'> & { employee: WrAssignee['employee'] | WrAssignee['employee'][] }
export type RawRow = Omit<WrRow, 'requester' | 'assignee' | 'assignees' | 'is_private' | 'assign_mode' | 'tag_ids'> & {
  tag_links?: { tag_id: string }[] | null
  is_private?: boolean | null
  assign_mode?: WrRow['assign_mode'] | null
  requester: WrRow['requester'] | WrRow['requester'][]
  assignee: WrRow['assignee'] | WrRow['assignee'][]
  assignees?: RawAssignee[] | null
}
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
export const normalize = ({ tag_links, ...r }: RawRow): WrRow => ({
  ...r,
  tag_ids: (tag_links ?? []).map(l => l.tag_id),
  is_private: !!r.is_private,
  assign_mode: r.assign_mode ?? 'single',
  requester: one(r.requester),
  assignee: one(r.assignee),
  // 담당자 행 정렬: 수락·진행 중인 사람 먼저, 그다음 미확인, 반려·해제는 뒤로; 같은 상태는 이름순
  assignees: (r.assignees ?? []).map(a => ({ ...a, employee: one(a.employee) })).sort((x, y) => rank(x.status) - rank(y.status) || (x.employee?.name ?? '').localeCompare(y.employee?.name ?? '', 'ko')),
})
const rank = (s: WrAssignee['status']) => ({ done_reported: 0, in_progress: 1, accepted: 2, invited: 3, rejected: 4, released: 5 }[s] ?? 9)

// 동적 select 라 supabase-js 가 행 타입을 추론하지 못하므로 결과를 T 로 단언한다.
// 904(태그) 적용 여부 — 적용 전에는 태그 열 없이 조회한다. 미적용 판정은 60초만 기억(적용 직후 곧 반영), 적용 판정은 계속 기억.
let tagsMissingUntil = 0
let tagsKnownReady = false
export async function tagsReady(admin: SupabaseClient): Promise<boolean> {
  if (tagsKnownReady) return true
  if (Date.now() < tagsMissingUntil) return false
  const { error } = await admin.from('work_request_tag_links').select('tag_id').limit(1)
  if (error) { tagsMissingUntil = Date.now() + 60_000; return false }
  tagsKnownReady = true
  return true
}
// 요청 조회에 쓸 select — 태그 적용 환경이면 태그 연결 포함
export const rowSelect = async (admin: SupabaseClient) => (await tagsReady(admin)) ? ROW_SELECT_TAGS : ROW_SELECT

export async function selectRows<T>(
  build: (select: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  if (Date.now() >= tagsMissingUntil) {
    const res = await build(ROW_SELECT_TAGS)
    if (!res.error) { tagsKnownReady = true; return { data: (res.data as T | null) ?? null, error: null } }
    if (!isMissing904(res.error.message)) return { data: null, error: res.error }
    tagsMissingUntil = Date.now() + 60_000; tagsKnownReady = false
  }
  const res = await build(ROW_SELECT)
  return { data: (res.data as T | null) ?? null, error: res.error }
}

// 태그 마스터 전체(숨김 포함, 순서대로). 904 미적용이면 빈 배열.
export async function loadTags(admin: SupabaseClient): Promise<WrTag[]> {
  if (!(await tagsReady(admin))) return []
  const { data, error } = await admin.from('work_request_tags').select('id, code, label, color, keywords, sort, active').order('sort').order('label')
  if (error) return []
  return ((data ?? []) as WrTag[]).map(t => ({ ...t, keywords: t.keywords ?? [] }))
}
// 알림 · PC 알림 본문 앞에 붙일 대표 태그(마스터 순서 첫 번째) — "[수금 · 계산서] "
export const tagPrefix = (tagIds: string[] | undefined, tags: WrTag[]) => {
  if (!tagIds?.length) return ''
  const t = tags.find(x => tagIds.includes(x.id))
  return t ? `[${t.label}] ` : ''
}
// 요청 id → 대표 태그 이름 (알림용, 소수 id). 904 미적용 · 오류면 빈 맵.
export async function firstTagLabels(admin: SupabaseClient, requestIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(requestIds))
  if (!ids.length || !(await tagsReady(admin))) return out
  const tags = await loadTags(admin)
  const order = new Map(tags.map((t, i) => [t.id, i]))
  const best = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from('work_request_tag_links').select('request_id, tag_id').in('request_id', ids.slice(i, i + 100))
    if (error) return out
    for (const l of (data ?? []) as { request_id: string; tag_id: string }[]) {
      const rank = order.get(l.tag_id)
      if (rank === undefined) continue
      if (!best.has(l.request_id) || rank < best.get(l.request_id)!) best.set(l.request_id, rank)
    }
  }
  for (const [rid, rank] of Array.from(best.entries())) out.set(rid, tags[rank].label)
  return out
}
// 요청의 태그 연결을 통째로 바꾼다 (없앨 것 삭제 → 새 것 추가)
export async function replaceTagLinks(admin: SupabaseClient, requestId: string, prev: string[], next: string[]): Promise<string | null> {
  const drop = prev.filter(id => !next.includes(id)), add = next.filter(id => !prev.includes(id))
  if (drop.length) { const { error } = await admin.from('work_request_tag_links').delete().eq('request_id', requestId).in('tag_id', drop); if (error) return error.message }
  if (add.length) { const { error } = await admin.from('work_request_tag_links').insert(add.map(tag_id => ({ request_id: requestId, tag_id }))); if (error) return error.message }
  return null
}

// 비공개 요청을 볼 수 있는가 — 요청자·담당자(해제·반려된 사람 포함)·승인권자(isManagerLike 는 호출 측에서 판정해 넘김)
export const canSeePrivate = (row: WrRow, meId: string | null, approver: boolean) =>
  !row.is_private || approver || (!!meId && (row.requester?.id === meId || row.assignees.some(a => a.employee?.id === meId)))

// 비공개인데 볼 수 없는 행 — 통계용으로 제목·내용을 가린 채 돌려준다(경영 현황 집계)
export const maskRow = (row: WrRow): WrRow => ({
  ...row, title: '(비공개 요청)', content: null, link: null, last_memo: null, reject_reason: null,
  assignees: row.assignees.map(a => ({ ...a, last_memo: null, reject_reason: null })),
})

// 담당자 행이 바뀐 뒤 요청 전체 상태·시각을 집계로 다시 쓴다. 끝난 요청(완료·취소)은 건드리지 않는다.
//  돌려주는 값: 적용한 patch (호출 측이 이력·알림에 쓴다)
export async function applyAggregate(admin: SupabaseClient, row: WrRow, now: string): Promise<Record<string, unknown>> {
  if (row.status === 'completed' || row.status === 'canceled') return {}
  const { data } = await admin.from('work_request_assignees').select('status, accepted_at, reported_at, rejected_at, reject_reason, employee:employees!work_request_assignees_employee_id_fkey(name)').eq('request_id', row.id)
  const rows = ((data ?? []) as unknown as { status: WrAssignee['status']; accepted_at: string | null; reported_at: string | null; rejected_at: string | null; reject_reason: string | null; employee: { name: string } | { name: string }[] | null }[])
  const status = aggregateStatus(rows)
  const firstAccept = rows.map(a => a.accepted_at).filter((x): x is string => !!x).sort()[0] ?? null
  const patch: Record<string, unknown> = { status, accepted_at: firstAccept }
  patch.reported_at = status === 'done_reported' ? (row.reported_at ?? now) : null
  if (status === 'rejected') {
    patch.rejected_at = now
    const reasons = rows.filter(a => a.status === 'rejected' && a.reject_reason).map(a => rows.length > 1 ? `${one(a.employee)?.name ?? ''}: ${a.reject_reason}` : a.reject_reason!)
    patch.reject_reason = reasons.join(' / ') || null
  } else { patch.rejected_at = null; patch.reject_reason = null }
  const { error } = await admin.from('work_requests').update(patch).eq('id', row.id)
  if (error) throw new Error(error.message)
  return patch
}
