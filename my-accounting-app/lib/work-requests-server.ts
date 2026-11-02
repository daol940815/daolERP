// 업무 요청 — 서버(API) 공용: 조회 select · 행 정규화 · 마이그레이션 안내 (route 파일은 핸들러만 export 해야 하므로 분리)
import type { WrRow } from '@/lib/work-requests'

export const MIGRATION_HINT = '900 마이그레이션(업무 요청)이 아직 적용되지 않았습니다. SQL 편집기에서 900_work_requests.sql을 실행해주세요.'
export const isMissing = (msg: string) => /work_requests|relation .* does not exist/i.test(msg)
// 901(비공개 열) 미적용 판정 — 이 경우 is_private 없이 다시 조회하고 전부 공개로 본다
export const isPrivateColMissing = (msg: string) => /is_private/i.test(msg)

const BASE_SELECT = `id, title, content, link, due_at, is_urgent, status, created_at, accepted_at, reported_at, completed_at,
  canceled_at, rejected_at, reject_reason, last_memo, last_memo_at,
  requester:employees!work_requests_requester_id_fkey(id, name, team),
  assignee:employees!work_requests_assignee_id_fkey(id, name, team)`
export const ROW_SELECT = `${BASE_SELECT}, is_private`
export const ROW_SELECT_LEGACY = BASE_SELECT

export type RawRow = Omit<WrRow, 'requester' | 'assignee' | 'is_private'> & {
  is_private?: boolean | null
  requester: WrRow['requester'] | WrRow['requester'][]
  assignee: WrRow['assignee'] | WrRow['assignee'][]
}
export const normalize = (r: RawRow): WrRow => ({
  ...r,
  is_private: !!r.is_private,
  requester: Array.isArray(r.requester) ? r.requester[0] ?? null : r.requester,
  assignee: Array.isArray(r.assignee) ? r.assignee[0] ?? null : r.assignee,
})

// 901 미적용 환경 폴백: is_private 포함 select 로 먼저 시도하고, 그 열 때문에 실패하면 옛 select 로 다시 시도한다.
// build(select) 는 select 문자열을 받아 쿼리를 만들고 실행한 Promise 를 돌려준다.
// (select 문자열이 동적이라 supabase-js 가 행 타입을 추론하지 못하므로 결과를 T 로 단언한다)
export async function selectWithPrivacy<T>(
  build: (select: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null; privacyReady: boolean }> {
  const first = await build(ROW_SELECT)
  if (!first.error) return { data: first.data as T | null, error: null, privacyReady: true }
  if (!isPrivateColMissing(first.error.message)) return { data: null, error: first.error, privacyReady: true }
  const second = await build(ROW_SELECT_LEGACY)
  return { data: (second.data as T | null) ?? null, error: second.error, privacyReady: false }
}

// 비공개 요청을 볼 수 있는가 — 요청자·담당자·승인권자(isManagerLike 는 호출 측에서 판정해 넘김)
export const canSeePrivate = (row: WrRow, meId: string | null, approver: boolean) =>
  !row.is_private || approver || (!!meId && (row.requester?.id === meId || row.assignee?.id === meId))

// 비공개인데 볼 수 없는 행 — 통계용으로 제목·내용을 가린 채 돌려준다(경영 현황 집계)
export const maskRow = (row: WrRow): WrRow => ({ ...row, title: '(비공개 요청)', content: null, link: null, last_memo: null, reject_reason: null })
