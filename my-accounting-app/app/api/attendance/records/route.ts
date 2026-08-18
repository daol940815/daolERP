import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { getAttendanceEmployee } from '@/lib/attendance-employee.server'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import {
  addDays, kstToday, kstToUtcIso, monthRange,
  type AttendanceLeave, type AttendanceRecord,
} from '@/lib/attendance'

export const dynamic = 'force-dynamic'

// 월별 근태 기록 조회 + 관리자 보정
// GET ?month=YYYY-MM&scope=self|all
//   self: 본인 기록 (전 등급) / all: 전 직원 (중간 관리자·전체 관리자)
//   상태(지각·결근 등)는 저장하지 않으므로 정책·기록·승인 휴가를 함께 내려
//   화면에서 lib/attendance.judgeDay로 판정한다.
// POST body.action (전체 관리자 전용):
//   adjust        { employee_id, work_date, check_in?, check_out?, edit_note } — 'HH:MM' KST, 빈값=삭제
//   delete_record { id }
//   set_target    { employee_id, attendance_target }
//   set_policy    { work_start, work_end, late_grace_min }

const MIGRATION_HINT = '200 마이그레이션(근태)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missingTable = (msg: string) => /attendance_|relation .* does not exist/i.test(msg)
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export async function GET(req: NextRequest) {
  // 직원 정보가 없는 계정도 자동 연결되므로 등급 구분 없이 본인 기록을 볼 수 있다
  const ctx = await getAttendanceEmployee()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { me, employeeId } = ctx

  const month = req.nextUrl.searchParams.get('month') ?? kstToday().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month 형식은 YYYY-MM' }, { status: 400 })
  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'self'
  if (scope === 'all' && me.role === 'sales') {
    return NextResponse.json({ error: '전 직원 조회는 관리자만 가능합니다.' }, { status: 403 })
  }

  const admin = createAdminClient()
  const [mStart, mEnd] = monthRange(month)

  const empQuery = admin.from('employees')
    .select('id, name, team, position, hire_date, is_active, attendance_target, auth_user_id')
    .order('is_active', { ascending: false }).order('name')

  const recQuery = (from: number, to: number) => {
    let q = admin.from('attendance_records')
      .select('id, employee_id, work_date, check_in_at, check_out_at, source, edited_by, edit_note')
      .gte('work_date', mStart).lte('work_date', mEnd)
      .order('work_date').range(from, to)
    if (scope === 'self') q = q.eq('employee_id', employeeId)
    return q
  }
  const leaveQuery = () => {
    let q = admin.from('attendance_leaves')
      .select('id, employee_id, leave_type, start_date, end_date, reason, status, decided_by, decide_note, created_at')
      .eq('status', 'approved').lte('start_date', mEnd).gte('end_date', mStart)
    if (scope === 'self') q = q.eq('employee_id', employeeId)
    return q
  }

  const [emps, recs, { data: leaves, error: e3 }, { data: policy, error: e4 }, { data: hols, error: e5 }] =
    await Promise.all([
      scope === 'all' ? empQuery : Promise.resolve({ data: null, error: null }),
      fetchAllRows<AttendanceRecord>((from, to) => recQuery(from, to)),
      leaveQuery(),
      admin.from('attendance_policy').select('work_start, work_end, late_grace_min').eq('id', 1).single(),
      // 휴가 일수 계산이 월 경계를 넘을 수 있어 앞뒤 한 달을 함께 읽는다
      admin.from('attendance_holidays').select('holiday_date, name')
        .gte('holiday_date', addDays(mStart, -31)).lte('holiday_date', addDays(mEnd, 31)),
    ])

  const err = ('error' in recs ? { message: recs.error } : null)
    ?? (emps && 'error' in emps && emps.error ? emps.error : null) ?? e3 ?? e4 ?? e5
  if (err) {
    const msg = typeof err === 'string' ? err : err.message
    return NextResponse.json({ error: missingTable(msg) ? MIGRATION_HINT : msg }, { status: 500 })
  }

  const holidays: Record<string, string> = {}
  for (const h of hols ?? []) holidays[h.holiday_date as string] = h.name as string

  return NextResponse.json({
    month, today: kstToday(), policy, holidays,
    employees: emps && 'data' in emps ? emps.data : null,
    records: 'data' in recs ? recs.data : [],
    leaves: (leaves ?? []) as AttendanceLeave[],
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role !== 'admin') return NextResponse.json({ error: '전체 관리자만 가능합니다.' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | number | boolean | undefined>
  const action = body.action
  const now = new Date().toISOString()

  if (action === 'adjust') {
    const employeeId = String(body.employee_id ?? '')
    const workDate = String(body.work_date ?? '')
    const editNote = String(body.edit_note ?? '').trim()
    const checkIn = String(body.check_in ?? '').trim()
    const checkOut = String(body.check_out ?? '').trim()
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json({ error: 'employee_id와 work_date(YYYY-MM-DD)가 필요합니다.' }, { status: 400 })
    }
    if (!editNote) return NextResponse.json({ error: '보정 사유(edit_note)를 입력하세요.' }, { status: 400 })
    for (const t of [checkIn, checkOut]) {
      if (t && !HHMM.test(t)) return NextResponse.json({ error: '시각은 HH:MM 형식으로 입력하세요.' }, { status: 400 })
    }
    if (checkIn && checkOut && checkOut < checkIn) {
      return NextResponse.json({ error: '퇴근 시각이 출근 시각보다 빠릅니다.' }, { status: 400 })
    }

    const { data: cur, error: cErr } = await admin.from('attendance_records')
      .select('id').eq('employee_id', employeeId).eq('work_date', workDate).maybeSingle()
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

    const fields = {
      check_in_at: checkIn ? kstToUtcIso(workDate, checkIn) : null,
      check_out_at: checkOut ? kstToUtcIso(workDate, checkOut) : null,
      edited_by: me.employeeId, edited_at: now, edit_note: editNote, updated_at: now,
    }
    if (!checkIn && !checkOut && !cur) {
      return NextResponse.json({ error: '기록이 없는 날짜입니다. 시각을 입력하세요.' }, { status: 400 })
    }
    const { error } = cur
      ? await admin.from('attendance_records').update(fields).eq('id', cur.id)
      : await admin.from('attendance_records')
          .insert({ employee_id: employeeId, work_date: workDate, source: 'admin', ...fields })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_record') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('attendance_records').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_target') {
    const employeeId = String(body.employee_id ?? '')
    if (!employeeId) return NextResponse.json({ error: 'employee_id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('employees')
      .update({ attendance_target: body.attendance_target === true }).eq('id', employeeId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_policy') {
    const workStart = String(body.work_start ?? '')
    const workEnd = String(body.work_end ?? '')
    const grace = Number(body.late_grace_min ?? 0)
    if (!HHMM.test(workStart) || !HHMM.test(workEnd)) {
      return NextResponse.json({ error: '근무 시각은 HH:MM 형식으로 입력하세요.' }, { status: 400 })
    }
    if (!Number.isInteger(grace) || grace < 0 || grace > 180) {
      return NextResponse.json({ error: '지각 유예는 0~180분 사이의 정수여야 합니다.' }, { status: 400 })
    }
    const { error } = await admin.from('attendance_policy')
      .update({ work_start: workStart, work_end: workEnd, late_grace_min: grace, updated_at: now })
      .eq('id', 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
