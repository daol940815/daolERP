import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { monthRange } from '@/lib/attendance'
import { OPEN_STATUSES, DUE_TRACKED, hoursBetween, type WrRow } from '@/lib/work-requests'
import { ROW_SELECT, normalize, isMissing, MIGRATION_HINT, type RawRow } from '@/lib/work-requests-server'

export const dynamic = 'force-dynamic'

// 업무 요청 현황 (경영 현황, 조회 전용) — API_OWNERS: /api/work-requests/overview → mgmt
// GET ?month=YYYY-MM → 이달 생성분 + 지금 열린 건 전체. 직원별 집계 · 주의 목록 · 요약.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') ?? '') ? sp.get('month')! : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)
  const [from, to] = monthRange(month)
  // KST 월 경계를 UTC ISO로 (URL 필터에 '+'가 들어가면 공백으로 읽히므로 Z 표기 사용)
  const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString(), toIso = new Date(`${to}T23:59:59+09:00`).toISOString()
  const fromT = new Date(fromIso).getTime(), toT = new Date(toIso).getTime()

  const result = await fetchAllRows<RawRow>((f, t) =>
    admin.from('work_requests').select(ROW_SELECT)
      .or(`status.in.(${OPEN_STATUSES.join(',')}),and(created_at.gte.${fromIso},created_at.lte.${toIso})`)
      .order('created_at', { ascending: false }).range(f, t),
  )
  if ('error' in result) return NextResponse.json({ error: isMissing(result.error) ? MIGRATION_HINT : result.error }, { status: 500 })
  const rows: WrRow[] = result.data.map(normalize)
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

  // 직원별
  type Agg = { id: string; name: string; team: string | null; received: number; open: number; overdue: number; completed: number; sent: number }
  const by = new Map<string, Agg>()
  const get = (p: WrRow['assignee']) => {
    if (!p) return null
    let a = by.get(p.id)
    if (!a) { a = { id: p.id, name: p.name, team: p.team, received: 0, open: 0, overdue: 0, completed: 0, sent: 0 }; by.set(p.id, a) }
    return a
  }
  for (const r of rows) {
    const a = get(r.assignee); const q = get(r.requester)
    if (a) {
      if (inMonth(r.created_at)) a.received++
      if (open(r)) a.open++
      if (overdue(r)) a.overdue++
      if (inMonth(r.completed_at)) a.completed++
    }
    if (q && inMonth(r.created_at)) q.sent++
  }
  const employees = Array.from(by.values()).sort((x, y) => y.open - x.open || y.received - x.received || x.name.localeCompare(y.name, 'ko'))

  const attention = rows.filter(r => overdue(r) || unreadLong(r))
    .map(r => ({ ...r, reason: overdue(r) ? 'overdue' : 'unread' }))
    .sort((x, y) => (x.reason === y.reason ? x.due_at.localeCompare(y.due_at) : x.reason === 'overdue' ? -1 : 1))

  return NextResponse.json({ summary, employees, attention, rows })
}
