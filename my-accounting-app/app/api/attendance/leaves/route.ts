import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { HALF_DAY_TYPES, type LeaveType } from '@/lib/attendance'

export const dynamic = 'force-dynamic'

// 휴가 신청·승인
// GET ?scope=self|all[&status=requested]
//   self: 내 신청 이력 / all: 전 직원 (중간 관리자·전체 관리자 — 승인 화면용)
// POST body.action:
//   request { leave_type, start_date, end_date, reason? } — 본인 신청. 반차는 하루짜리만
//   cancel  { id } — 본인의 승인 대기 건 취소. 승인된 건은 전체 관리자만 취소 가능
//   approve / reject { id, note? } — 중간 관리자·전체 관리자.
//     중간 관리자는 본인 신청을 스스로 승인·반려할 수 없다

const MIGRATION_HINT = '200 마이그레이션(근태)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missingTable = (msg: string) => /attendance_|relation .* does not exist/i.test(msg)
const LEAVE_TYPES: LeaveType[] = ['annual', 'half_am', 'half_pm', 'sick', 'official', 'other']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const LEAVE_COLS = 'id, employee_id, leave_type, start_date, end_date, reason, status, decided_by, decided_at, decide_note, created_at'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'self'
  const status = req.nextUrl.searchParams.get('status')
  if (scope === 'all' && me.role === 'sales') {
    return NextResponse.json({ error: '전 직원 조회는 관리자만 가능합니다.' }, { status: 403 })
  }
  if (scope === 'self' && !me.employeeId) {
    return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
  }

  const admin = createAdminClient()
  let q = admin.from('attendance_leaves')
    .select(LEAVE_COLS)
    .order('created_at', { ascending: false }).limit(200)
  if (scope === 'self') q = q.eq('employee_id', me.employeeId!)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: missingTable(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
  }

  // 직원명은 별도 조회 후 합침 (FK 임베드 대신 — 관계명 의존 없이 동작)
  let leaves: Record<string, unknown>[] = data ?? []
  if (scope === 'all' && leaves.length) {
    const ids = Array.from(new Set(leaves.map(l => l.employee_id as string)))
    const { data: emps, error: eErr } = await admin.from('employees')
      .select('id, name, team').in('id', ids)
    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })
    const byId = new Map((emps ?? []).map(e => [e.id as string, e]))
    leaves = leaves.map(l => ({ ...l, employee: byId.get(l.employee_id as string) ?? null }))
  }
  return NextResponse.json({ leaves, myEmployeeId: me.employeeId })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | undefined>
  const action = body.action
  const now = new Date().toISOString()

  if (action === 'request') {
    if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
    const leaveType = body.leave_type as LeaveType
    const start = body.start_date ?? ''
    const end = body.end_date ?? ''
    if (!LEAVE_TYPES.includes(leaveType)) return NextResponse.json({ error: '휴가 종류가 올바르지 않습니다.' }, { status: 400 })
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return NextResponse.json({ error: '날짜 형식은 YYYY-MM-DD' }, { status: 400 })
    if (end < start) return NextResponse.json({ error: '종료일이 시작일보다 빠릅니다.' }, { status: 400 })
    if (HALF_DAY_TYPES.includes(leaveType) && start !== end) {
      return NextResponse.json({ error: '반차는 하루만 선택할 수 있습니다.' }, { status: 400 })
    }

    // 기간이 겹치는 기존 신청(대기·승인)이 있으면 중복 신청 차단
    const { data: overlap, error: oErr } = await admin.from('attendance_leaves')
      .select('id, start_date, end_date, status')
      .eq('employee_id', me.employeeId)
      .in('status', ['requested', 'approved'])
      .lte('start_date', end).gte('end_date', start).limit(1)
    if (oErr) {
      return NextResponse.json({ error: missingTable(oErr.message) ? MIGRATION_HINT : oErr.message }, { status: 500 })
    }
    if (overlap?.length) {
      return NextResponse.json({ error: `해당 기간에 이미 신청·승인된 휴가가 있습니다 (${overlap[0].start_date}~${overlap[0].end_date}).` }, { status: 400 })
    }

    const { error } = await admin.from('attendance_leaves').insert({
      employee_id: me.employeeId, leave_type: leaveType,
      start_date: start, end_date: end,
      reason: (body.reason ?? '').trim() || null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'cancel') {
    const id = body.id
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { data: leave, error: e1 } = await admin.from('attendance_leaves')
      .select('employee_id, status').eq('id', id).single()
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    const mine = leave.employee_id === me.employeeId
    const canCancel = (mine && leave.status === 'requested') ||
      (me.role === 'admin' && ['requested', 'approved'].includes(leave.status))
    if (!canCancel) {
      return NextResponse.json({ error: '취소할 수 없습니다. 본인의 승인 대기 건만 취소 가능하며, 승인된 건은 전체 관리자에게 요청하세요.' }, { status: 403 })
    }
    const { error } = await admin.from('attendance_leaves')
      .update({ status: 'canceled', decided_by: me.employeeId, decided_at: now }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'approve' || action === 'reject') {
    if (me.role === 'sales') return NextResponse.json({ error: '승인 권한이 없습니다.' }, { status: 403 })
    const id = body.id
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { data: leave, error: e1 } = await admin.from('attendance_leaves')
      .select('employee_id, status').eq('id', id).single()
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    if (leave.status !== 'requested') {
      return NextResponse.json({ error: '승인 대기 상태가 아닙니다.' }, { status: 400 })
    }
    if (me.role === 'manager' && leave.employee_id === me.employeeId) {
      return NextResponse.json({ error: '본인 신청은 본인이 결재할 수 없습니다.' }, { status: 403 })
    }
    const { error } = await admin.from('attendance_leaves').update({
      status: action === 'approve' ? 'approved' : 'rejected',
      decided_by: me.employeeId, decided_at: now,
      decide_note: (body.note ?? '').trim() || null,
    }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
