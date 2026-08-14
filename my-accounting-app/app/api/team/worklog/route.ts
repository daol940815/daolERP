import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { WORK_LOG_ACTIONS, WORK_LOG_MIGRATION_HINT, isWorkLogMissing, kstToday } from '@/lib/work-log'

export const dynamic = 'force-dynamic'

// 팀 업무 현황 (manager/admin 전용) — 직원별로 들어가 보지 않아도 되도록 집계.
// GET ?period=today|week|month  (기본 week)
// 활동이 없는 직원도 행으로 남긴다 — "오늘 아무 기록도 없는 직원"이 보여야 한다.

// KST 기준 기간 계산
function periodRange(period: string): { from: string; to: string; label: string } {
  const today = kstToday()
  if (period === 'today') return { from: today, to: today, label: '오늘' }
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today, label: '이번 달' }
  // 이번 주 (월요일 시작)
  const d = new Date(`${today}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7            // 월=0
  d.setUTCDate(d.getUTCDate() - dow)
  return { from: d.toISOString().slice(0, 10), to: today, label: '이번 주' }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role === 'sales') {
    return NextResponse.json({ error: '팀 업무 현황은 관리자만 볼 수 있습니다.' }, { status: 403 })
  }
  const admin = createAdminClient()
  const range = periodRange(req.nextUrl.searchParams.get('period') ?? 'week')

  const { data: emps, error: eErr } = await admin.from('employees')
    .select('id, name, position, role').eq('is_active', true).order('name')
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

  const logs = await fetchAllRows<{ employee_id: string; action: string; source: string; logged_at: string }>(
    (from, to) => admin.from('erp_work_logs')
      .select('employee_id, action, source, logged_at')
      .gte('work_date', range.from).lte('work_date', range.to)
      .order('logged_at', { ascending: false })
      .range(from, to),
  )
  if ('error' in logs) {
    return NextResponse.json({
      error: isWorkLogMissing(logs.error) ? WORK_LOG_MIGRATION_HINT : logs.error,
    }, { status: 500 })
  }

  const byEmp = new Map<string, { counts: Record<string, number>; total: number; last: string | null }>()
  for (const l of logs.data) {
    let cur = byEmp.get(l.employee_id)
    if (!cur) { cur = { counts: {}, total: 0, last: null }; byEmp.set(l.employee_id, cur) }
    cur.counts[l.action] = (cur.counts[l.action] ?? 0) + 1
    cur.total += 1
    if (!cur.last || l.logged_at > cur.last) cur.last = l.logged_at
  }

  const rows = (emps ?? []).map(e => {
    const s = byEmp.get(e.id as string)
    return {
      employee_id: e.id as string,
      name: e.name as string,
      position: (e.position as string) ?? null,
      role: (e.role as string) ?? 'sales',
      counts: s?.counts ?? {},
      total: s?.total ?? 0,
      last_at: s?.last ?? null,
    }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko'))

  const totals: Record<string, number> = {}
  for (const r of rows) for (const a of WORK_LOG_ACTIONS) totals[a] = (totals[a] ?? 0) + (r.counts[a] ?? 0)

  return NextResponse.json({
    rows, totals, actions: WORK_LOG_ACTIONS,
    period: req.nextUrl.searchParams.get('period') ?? 'week',
    period_label: range.label, from: range.from, to: range.to,
    grand_total: rows.reduce((s, r) => s + r.total, 0),
    active_cnt: rows.filter(r => r.total > 0).length,
  })
}
