import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { kstToday, addDays, dayOfWeek } from '@/lib/attendance'
import { DUE_TRACKED, OPEN_STATUSES } from '@/lib/work-requests'

export const dynamic = 'force-dynamic'

// 새 요청에서 담당자를 고르면 보여주는 "그 직원의 오늘 상황" — 여유를 계산해 주지 않는다 (문제 1은 조회로 푼다).
// GET ?employee_id=  → 오늘 근태 · 이번 주 휴가 · 진행 중 요청(오늘 마감·지남) · 최근 업무일지 1건
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('employee_id')
  if (!id) return NextResponse.json({ error: 'employee_id가 필요합니다.' }, { status: 400 })
  const admin = createAdminClient()
  const today = kstToday()
  const dow = dayOfWeek(today)                                   // 0=일
  const weekStart = addDays(today, -((dow + 6) % 7))             // 월요일
  const weekEnd = addDays(weekStart, 6)
  const now = new Date()

  const [att, leaves, reqs, log] = await Promise.all([
    admin.from('attendance_records').select('check_in_at, check_out_at').eq('employee_id', id).eq('work_date', today).maybeSingle(),
    admin.from('attendance_leaves').select('leave_type, start_date, end_date, status').eq('employee_id', id)
      .in('status', ['approved', 'requested']).lte('start_date', weekEnd).gte('end_date', weekStart).order('start_date'),
    admin.from('work_requests').select('status, due_at').eq('assignee_id', id).in('status', OPEN_STATUSES),
    admin.from('erp_work_logs').select('work_date, content').eq('employee_id', id).order('work_date', { ascending: false }).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const open = (reqs.data ?? []) as { status: string; due_at: string }[]
  const tracked = open.filter(r => DUE_TRACKED.includes(r.status as never))
  const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
  return NextResponse.json({
    today,
    attendance: att.error ? null : att.data ?? null,
    attendanceReady: !att.error,
    leaves: leaves.error ? [] : leaves.data ?? [],
    open_count: reqs.error ? null : open.length,
    due_today: tracked.filter(r => dayOf(r.due_at) === today && new Date(r.due_at) >= now).length,
    overdue: tracked.filter(r => new Date(r.due_at) < now).length,
    last_log: log.error ? null : log.data ?? null,
  })
}
