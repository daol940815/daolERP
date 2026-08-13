import { NextRequest, NextResponse } from 'next/server'
import { getAttendanceEmployee } from '@/lib/attendance-employee.server'
import { kstToday, type AttendancePolicy } from '@/lib/attendance'

export const dynamic = 'force-dynamic'

// 본인 출퇴근 체크 — 등급 구분 없이 로그인한 모든 직원이 사용한다.
// 직원 정보가 없는 계정은 getAttendanceEmployee가 자동으로 연결·생성한다.
// GET: 오늘(KST) 내 기록 + 근태 정책
// POST body.action:
//   check_in  — 오늘 첫 출근 체크 (이미 체크했으면 오류)
//   check_out — 퇴근 체크 (재체크 시 마지막 시각으로 갱신)

const MIGRATION_HINT = '200 마이그레이션(근태)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missingTable = (msg: string) => /attendance_|relation .* does not exist|attendance_target/i.test(msg)

async function loadContext() {
  const ctx = await getAttendanceEmployee()
  if ('error' in ctx) return { error: missingTable(ctx.error) ? MIGRATION_HINT : ctx.error, status: ctx.status }
  const { admin, employeeId } = ctx
  const [{ data: emp, error: e1 }, { data: policy, error: e2 }] = await Promise.all([
    admin.from('employees')
      .select('id, name, is_active, attendance_target, hire_date').eq('id', employeeId).single(),
    admin.from('attendance_policy').select('work_start, work_end, late_grace_min').eq('id', 1).single(),
  ])
  const err = e1 ?? e2
  if (err) return { error: missingTable(err.message) ? MIGRATION_HINT : err.message, status: 500 as const }
  return { admin, emp: emp!, policy: policy as AttendancePolicy }
}

export async function GET() {
  const ctx = await loadContext()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, emp, policy } = ctx
  const today = kstToday()

  const [{ data: record, error: e1 }, { data: leave, error: e2 }] = await Promise.all([
    admin.from('attendance_records')
      .select('id, employee_id, work_date, check_in_at, check_out_at, source, edited_by, edit_note')
      .eq('employee_id', emp.id).eq('work_date', today).maybeSingle(),
    admin.from('attendance_leaves')
      .select('id, employee_id, leave_type, start_date, end_date, reason, status, decided_by, decide_note, created_at')
      .eq('employee_id', emp.id).eq('status', 'approved')
      .lte('start_date', today).gte('end_date', today).limit(1).maybeSingle(),
  ])
  const err = e1 ?? e2
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({
    today, policy,
    isTarget: emp.is_active,
    record: record ?? null,
    todayLeave: leave ?? null,
  })
}

export async function POST(req: NextRequest) {
  const ctx = await loadContext()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, emp } = ctx
  const body = await req.json().catch(() => ({})) as { action?: string }
  const today = kstToday()
  const now = new Date().toISOString()

  if (!emp.is_active) return NextResponse.json({ error: '비활성 직원은 체크할 수 없습니다.' }, { status: 400 })
  // 체크를 사용하는 직원은 근태 현황 집계에도 나와야 한다
  if (!emp.attendance_target) {
    await admin.from('employees').update({ attendance_target: true }).eq('id', emp.id)
  }

  const { data: cur, error: cErr } = await admin.from('attendance_records')
    .select('id, check_in_at, check_out_at').eq('employee_id', emp.id).eq('work_date', today).maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  if (body.action === 'check_in') {
    if (cur?.check_in_at) return NextResponse.json({ error: '오늘은 이미 출근 체크했습니다.' }, { status: 400 })
    const { error } = cur
      ? await admin.from('attendance_records')
          .update({ check_in_at: now, updated_at: now }).eq('id', cur.id)
      : await admin.from('attendance_records')
          .insert({ employee_id: emp.id, work_date: today, check_in_at: now, source: 'self' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, at: now })
  }

  if (body.action === 'check_out') {
    if (!cur?.check_in_at) return NextResponse.json({ error: '출근 체크가 없습니다. 먼저 출근 체크를 해주세요.' }, { status: 400 })
    const { error } = await admin.from('attendance_records')
      .update({ check_out_at: now, updated_at: now }).eq('id', cur.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, at: now, replaced: !!cur.check_out_at })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
