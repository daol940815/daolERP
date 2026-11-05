import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { OPEN_STATUSES, ASG_ACTIVE, ASG_TRACKED, type WrStatus, type WrAsgStatus } from '@/lib/work-requests'
import { hintFor } from '@/lib/work-requests-server'

export const dynamic = 'force-dynamic'

// 새 요청에서 담당자를 고르면 보여주는 "선택한 담당자가 맡고 있는 업무" (2026-11-02 사용자 요청: 근태·휴가 대신 맡은 업무 목록)
// GET ?employee_ids=a,b,c  (employee_id 단수도 받음)
//  → 담당자별 열린 요청(내 몫이 미확인·수락·진행 중·처리 보고)을 마감 순으로. 비공개 요청은 요청자·담당자·승인권자가 아니면
//    제목을 가리고 건수만 센다. 여유 계산은 하지 않는다 — 판단은 요청자가.

interface Item { id: string; title: string; due_at: string; status: WrStatus; my_status: WrAsgStatus; is_urgent: boolean; is_private: boolean; hidden: boolean; requester: string | null }

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const ids = Array.from(new Set([...(sp.get('employee_ids') ?? '').split(','), sp.get('employee_id') ?? ''].map(s => s.trim()).filter(Boolean)))
  if (!ids.length) return NextResponse.json({ error: 'employee_ids가 필요합니다.' }, { status: 400 })
  if (ids.length > 60) return NextResponse.json({ error: '한 번에 60명까지 조회할 수 있습니다.' }, { status: 400 })
  const admin = createAdminClient()
  const approver = isManagerLike(me)
  const meId = me.employeeId

  type Raw = {
    employee_id: string; status: WrAsgStatus
    request: { id: string; title: string; due_at: string; status: WrStatus; is_urgent: boolean; is_private: boolean | null; requester_id: string; assignees: { employee_id: string }[] | null; requester: { name: string } | { name: string }[] | null } | null
  }
  const { data, error } = await admin.from('work_request_assignees')
    .select('employee_id, status, request:work_requests!inner(id, title, due_at, status, is_urgent, is_private, requester_id, assignees:work_request_assignees(employee_id), requester:employees!work_requests_requester_id_fkey(name))')
    .in('employee_id', ids).in('status', ASG_ACTIVE)
  if (error) return NextResponse.json({ error: hintFor(error.message) }, { status: 500 })

  const now = Date.now()
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
  const byEmp = new Map<string, Item[]>(ids.map(id => [id, []]))
  for (const raw of (data ?? []) as unknown as Raw[]) {
    const r: Raw['request'] = Array.isArray(raw.request) ? (raw.request as Raw['request'][])[0] ?? null : raw.request
    if (!r || !OPEN_STATUSES.includes(r.status)) continue
    const canSee = !r.is_private || approver || r.requester_id === meId || (r.assignees ?? []).some(a => a.employee_id === meId)
    const reqName = Array.isArray(r.requester) ? r.requester[0]?.name : r.requester?.name
    byEmp.get(raw.employee_id)?.push({
      id: r.id, title: canSee ? r.title : '(비공개 요청)', due_at: r.due_at, status: r.status, my_status: raw.status,
      is_urgent: r.is_urgent, is_private: !!r.is_private, hidden: !canSee, requester: canSee ? reqName ?? null : null,
    })
  }
  const employees = ids.map(id => {
    const items = (byEmp.get(id) ?? []).sort((a, b) => a.due_at.localeCompare(b.due_at))
    const tracked = items.filter(i => ASG_TRACKED.includes(i.my_status))
    return {
      id, items, total: items.length,
      hidden: items.filter(i => i.hidden).length,
      overdue: tracked.filter(i => new Date(i.due_at).getTime() < now).length,
      due_today: tracked.filter(i => dayOf(i.due_at) === today && new Date(i.due_at).getTime() >= now).length,
    }
  })
  return NextResponse.json({ today, employees })
}
