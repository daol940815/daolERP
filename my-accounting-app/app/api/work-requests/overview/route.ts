import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { monthRange } from '@/lib/attendance'
import { isManagerLike } from '@/lib/permissions'
import { OPEN_STATUSES, DUE_TRACKED, ASG_ACTIVE, ASG_TRACKED, hoursBetween, type WrRow } from '@/lib/work-requests'
import { ROW_SELECT, canSeePrivate, maskRow, normalize, hintFor, type RawRow } from '@/lib/work-requests-server'

export const dynamic = 'force-dynamic'

// 업무 요청 현황 (경영 현황, 조회 전용) — API_OWNERS: /api/work-requests/overview → mgmt
// GET ?month=YYYY-MM → 이달 생성분 + 지금 열린 건 전체. 직원별 집계 · 주의 목록 · 요약.
// 통계 중심(2026-11-02): 목록은 내 업무 › 업무 요청(공용)으로 드릴다운. 비공개 건은 집계에는 포함하되 제목은 승인권자 외에게 가린다.
// 902: 직원별 집계는 담당자 행 기준(공동 요청 1건 = 담당자 5명 각 1건, 선착 해제자는 제외). 요약 KPI는 요청 건 기준.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const approver = isManagerLike(me)
  const sp = req.nextUrl.searchParams
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') ?? '') ? sp.get('month')! : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)
  const [from, to] = monthRange(month)
  // KST 월 경계를 UTC ISO로 (URL 필터에 '+'가 들어가면 공백으로 읽히므로 Z 표기 사용)
  const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString(), toIso = new Date(`${to}T23:59:59+09:00`).toISOString()
  const fromT = new Date(fromIso).getTime(), toT = new Date(toIso).getTime()

  type Page = PromiseLike<{ data: RawRow[] | null; error: { message: string } | null }>
  const result = await fetchAllRows<RawRow>((f, t) =>
    admin.from('work_requests').select(ROW_SELECT)
      .or(`status.in.(${OPEN_STATUSES.join(',')}),and(created_at.gte.${fromIso},created_at.lte.${toIso})`)
      .order('created_at', { ascending: false }).range(f, t) as unknown as Page,   // 동적 select 라 행 타입 단언
  )
  if ('error' in result) return NextResponse.json({ error: hintFor(result.error) }, { status: 500 })
  const rows: WrRow[] = result.data.map(normalize).map(r => canSeePrivate(r, me.employeeId, approver) ? r : maskRow(r))
  const now = new Date()
  const inMonth = (iso: string | null) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= fromT && t <= toT }
  const open = (r: WrRow) => OPEN_STATUSES.includes(r.status)
  const overdue = (r: WrRow) => DUE_TRACKED.includes(r.status) && new Date(r.due_at) < now
  const unreadLong = (r: WrRow) => r.status === 'requested' && hoursBetween(r.created_at, now.toISOString()) > 24

  const created = rows.filter(r => inMonth(r.created_at))
  const durations = rows.filter(r => r.reported_at && inMonth(r.reported_at)).map(r => hoursBetween(r.created_at, r.reported_at!))
  const summary = {
    month,
    created: created.length,
    completed: rows.filter(r => inMonth(r.completed_at)).length,
    canceled: rows.filter(r => inMonth(r.canceled_at)).length,
    rejected: rows.filter(r => inMonth(r.rejected_at)).length,
    open: rows.filter(open).length,
    overdue: rows.filter(overdue).length,
    unread_24h: rows.filter(unreadLong).length,
    avg_hours_to_report: durations.length ? Math.round(durations.reduce((s, h) => s + h, 0) / durations.length) : null,
  }

  // 직원별 — 담당자 행 기준
  type Agg = { id: string; name: string; team: string | null; received: number; open: number; overdue: number; completed: number; sent: number }
  const by = new Map<string, Agg>()
  const get = (p: WrRow['requester']) => {
    if (!p) return null
    let a = by.get(p.id)
    if (!a) { a = { id: p.id, name: p.name, team: p.team, received: 0, open: 0, overdue: 0, completed: 0, sent: 0 }; by.set(p.id, a) }
    return a
  }
  for (const r of rows) {
    for (const asg of r.assignees) {
      if (asg.status === 'released') continue              // 선착에서 해제된 사람은 받은 것으로 치지 않는다
      const a = get(asg.employee)
      if (!a) continue
      if (inMonth(r.created_at)) a.received++
      if (open(r) && ASG_ACTIVE.includes(asg.status)) a.open++
      if (open(r) && ASG_TRACKED.includes(asg.status) && new Date(r.due_at) < now) a.overdue++
      if (inMonth(r.completed_at) && asg.status !== 'rejected') a.completed++
    }
    const q = get(r.requester)
    if (q && inMonth(r.created_at)) q.sent++
  }
  const employees = Array.from(by.values()).sort((x, y) => y.open - x.open || y.received - x.received || x.name.localeCompare(y.name, 'ko'))

  const attention = rows.filter(r => overdue(r) || unreadLong(r))
    .map(r => ({ ...r, reason: overdue(r) ? 'overdue' : 'unread' }))
    .sort((x, y) => (x.reason === y.reason ? x.due_at.localeCompare(y.due_at) : x.reason === 'overdue' ? -1 : 1))

  return NextResponse.json({ summary, employees, attention, rows })
}
