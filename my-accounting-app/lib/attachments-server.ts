// 공통 첨부 파일 — 서버 전용 (1200, 2026-11-11). 쓰는 곳(owner_type)별 권한 판정 등록 · 임시 업로드 연결 · 정리.
//  새 화면이 첨부를 쓰려면 ATTACHMENT_OWNERS 에 항목을 추가하고 lib/attachments.ts 의 ATTACH_OWNER_LABEL 에도 이름을 넣는다.
//  판정 함수는 비동기 — owner_id 로 원본(업무 요청 · 회의 등)을 조회해 그 화면의 공개 범위 · 상태 규칙을 그대로 따른다.
//  마스터 계정을 공통 층에서 일괄 통과시키지 않는다(비공개 업무 요청처럼 당사자만 보는 규칙이 있다) — 각 함수가 판단한다.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { ATTACH_BUCKET } from '@/lib/attachments'
import { OPEN_STATUSES, allowedActions, type WrRow } from '@/lib/work-requests'
import { selectRows, normalize, canSeePrivate, type RawRow } from '@/lib/work-requests-server'

export const MIGRATION_HINT_1200 = '1200 마이그레이션(공통 첨부 파일)이 아직 적용되지 않았습니다. SQL 편집기에서 1200_attachments.sql을 실행해주세요.'
export const isMissing1200 = (msg: string) => /attachments|relation .* does not exist|bucket not found|storage_usage_by_bucket/i.test(msg)

export interface AttachmentRecord { id: string; owner_type: string; owner_id: string | null; uploaded_by: string | null }
export interface OwnerRule {
  // 이 건의 첨부를 볼 수 있는가 (목록 · 내려받기)
  canView: (me: CurrentUser, ownerId: string, admin: SupabaseClient) => Promise<boolean>
  // 이 건에 파일을 붙일 수 있는가
  canAdd: (me: CurrentUser, ownerId: string, admin: SupabaseClient) => Promise<boolean>
  // 이 파일을 지울 수 있는가
  canDelete: (me: CurrentUser, att: AttachmentRecord, admin: SupabaseClient) => Promise<boolean>
}

// ── 업무 요청 ──
async function loadWr(admin: SupabaseClient, id: string): Promise<WrRow | null> {
  const { data } = await selectRows<RawRow>(sel => admin.from('work_requests').select(sel).eq('id', id).maybeSingle())
  return data ? normalize(data) : null
}
const workRequestRule: OwnerRule = {
  // 상세를 볼 수 있는 사람과 같다: 공개 요청은 전원, 비공개는 요청자 · 담당자 · 승인권자
  canView: async (me, id, admin) => {
    const row = await loadWr(admin, id)
    return !!row && canSeePrivate(row, me.employeeId, isManagerLike(me))
  },
  // 붙이기: 열린 요청의 요청자 · 살아 있는 담당자 (진행 메모를 남길 수 있는 사람과 같다)
  canAdd: async (me, id, admin) => {
    const row = await loadWr(admin, id)
    if (!row || !OPEN_STATUSES.includes(row.status)) return false
    const a = allowedActions(row, me.employeeId)
    return a.isReq || a.isAsg
  },
  // 지우기: 올린 사람 · 마스터 계정
  canDelete: async (me, att) => !!me.isMaster || (!!me.employeeId && att.uploaded_by === me.employeeId),
}

export const ATTACHMENT_OWNERS: Record<string, OwnerRule> = {
  work_request: workRequestRule,
}

// 저장 API 가 원본(업무 요청 등)을 만든 직후 호출 — 작성 중 올린 임시 파일을 그 건에 연결한다. 본인이 올린 것만.
//  1200 미적용이면 조용히 0 을 돌려준다(원본 저장을 막지 않는다).
export async function linkDraftAttachments(admin: SupabaseClient, p: { ownerType: string; ownerId: string; draftKey: string | null | undefined; employeeId: string }): Promise<number> {
  if (!p.draftKey || !/^[0-9a-f-]{36}$/i.test(p.draftKey)) return 0
  const { data, error } = await admin.from('attachments')
    .update({ owner_id: p.ownerId, draft_key: null })
    .eq('owner_type', p.ownerType).eq('draft_key', p.draftKey).eq('uploaded_by', p.employeeId).is('owner_id', null).is('deleted_at', null)
    .select('id')
  if (error) return 0
  return data?.length ?? 0
}

// 아침 크론 — 하루가 지나도 연결되지 않은 임시 파일(작성하다 취소한 것)을 지운다. 기록 행도 지운다(원본에 붙은 적이 없는 파일).
export async function purgeStaleDrafts(admin: SupabaseClient, olderThanHours = 24): Promise<{ removed: number }> {
  const before = new Date(Date.now() - olderThanHours * 3600_000).toISOString()
  const { data, error } = await admin.from('attachments').select('id, storage_path').is('owner_id', null).lt('created_at', before).limit(500)
  if (error || !data?.length) return { removed: 0 }
  for (let i = 0; i < data.length; i += 100) {
    const chunk = data.slice(i, i + 100)
    await admin.storage.from(ATTACH_BUCKET).remove(chunk.map(d => d.storage_path))
    await admin.from('attachments').delete().in('id', chunk.map(d => d.id))
  }
  return { removed: data.length }
}
