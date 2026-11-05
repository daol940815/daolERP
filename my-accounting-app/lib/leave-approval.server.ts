import type { SupabaseClient } from '@supabase/supabase-js'
import {
  asLevel, emptyRoster, turnLevel,
  type ApproveLevel, type ApproverRoster, type LeaveStep,
} from '@/lib/leave-approval'

// 휴가 3단계 결재 — 서버 전용 조회 (204). 화면 규칙은 lib/leave-approval.ts.
// 204 미적용이면 ready=false 를 돌려주고, 라우트는 기존 1단계 승인(can_approve)으로 동작한다.

export interface ApprovalCtx {
  ready: boolean
  roster: ApproverRoster
  levelOf: (employeeId: string | null | undefined) => ApproveLevel | null
}

/** 결재 권한자 명단 + 204 적용 여부 */
export async function loadApprovalCtx(admin: SupabaseClient): Promise<ApprovalCtx> {
  const [emps, steps] = await Promise.all([
    admin.from('employees').select('id, name, position, leave_approve_level, work_end')
      .eq('is_active', true).not('leave_approve_level', 'is', null).order('name'),
    admin.from('attendance_leave_steps').select('id', { count: 'exact', head: true }),
  ])
  const roster = emptyRoster()
  if (emps.error || steps.error) return { ready: false, roster, levelOf: () => null }
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const level = new Map<string, ApproveLevel>()
  for (const e of (emps.data ?? []) as { id: string; name: string; position: string | null; leave_approve_level: number; work_end: string | null }[]) {
    const lv = asLevel(e.leave_approve_level)
    if (!lv || (e.work_end && e.work_end < today)) continue   // 근무 종료된 아르바이트는 제외
    level.set(e.id, lv)
    roster[lv].push({ id: e.id, name: e.name, position: e.position })
  }
  return { ready: true, roster, levelOf: id => (id ? level.get(id) ?? null : null) }
}

/** 휴가별 결재 이력 (처리자 이름 포함). .in() 은 150개씩 나눈다 */
export async function loadSteps(admin: SupabaseClient, leaveIds: string[]): Promise<Map<string, LeaveStep[]>> {
  const out = new Map<string, LeaveStep[]>()
  const rows: (LeaveStep & { leave_id: string })[] = []
  for (let i = 0; i < leaveIds.length; i += 150) {
    const { data, error } = await admin.from('attendance_leave_steps')
      .select('leave_id, step, action, actor_id, actor_level, note, created_at')
      .in('leave_id', leaveIds.slice(i, i + 150))
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as (LeaveStep & { leave_id: string })[]))
  }
  const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter((v): v is string => !!v)))
  const names = new Map<string, string>()
  for (let i = 0; i < actorIds.length; i += 150) {
    const { data } = await admin.from('employees').select('id, name').in('id', actorIds.slice(i, i + 150))
    for (const e of data ?? []) names.set(e.id as string, e.name as string)
  }
  for (const r of rows) {
    const list = out.get(r.leave_id) ?? []
    list.push({ ...r, actor_name: r.actor_id ? names.get(r.actor_id) ?? null : null })
    out.set(r.leave_id, list)
  }
  for (const list of Array.from(out.values())) list.sort((a, b) => a.step - b.step)
  return out
}

/** 이 단계 차례인 사람들 (알림 대상) — 신청자 제외 */
export function turnPeople(step: ApproveLevel, roster: ApproverRoster, applicantId: string): string[] {
  const lv = turnLevel(step, roster, applicantId)
  return lv ? roster[lv].filter(p => p.id !== applicantId).map(p => p.id) : []
}

/** 특정 단계 권한자 (사후 알림 대상) — 신청자 제외 */
export const levelPeople = (lv: ApproveLevel, roster: ApproverRoster, exceptId: string) =>
  roster[lv].filter(p => p.id !== exceptId).map(p => p.id)
