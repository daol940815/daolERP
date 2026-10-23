// 업무 요청 — 서버(API) 공용: 조회 select · 행 정규화 · 마이그레이션 안내 (route 파일은 핸들러만 export 해야 하므로 분리)
import type { WrRow } from '@/lib/work-requests'

export const MIGRATION_HINT = '900 마이그레이션(업무 요청)이 아직 적용되지 않았습니다. SQL 편집기에서 900_work_requests.sql을 실행해주세요.'
export const isMissing = (msg: string) => /work_requests|relation .* does not exist/i.test(msg)

export const ROW_SELECT = `id, title, content, link, due_at, is_urgent, status, created_at, accepted_at, reported_at, completed_at,
  canceled_at, rejected_at, reject_reason, last_memo, last_memo_at,
  requester:employees!work_requests_requester_id_fkey(id, name, team),
  assignee:employees!work_requests_assignee_id_fkey(id, name, team)`

export type RawRow = Omit<WrRow, 'requester' | 'assignee'> & {
  requester: WrRow['requester'] | WrRow['requester'][]
  assignee: WrRow['assignee'] | WrRow['assignee'][]
}
export const normalize = (r: RawRow): WrRow => ({
  ...r,
  requester: Array.isArray(r.requester) ? r.requester[0] ?? null : r.requester,
  assignee: Array.isArray(r.assignee) ? r.assignee[0] ?? null : r.assignee,
})
