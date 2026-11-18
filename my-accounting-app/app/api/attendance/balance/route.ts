import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can, isHrAdmin } from '@/lib/permissions'
import { kstToday, leaveDays } from '@/lib/attendance'
import {
  isHalfStep, recommendBase, GRANT_KIND_LABEL,
  type GrantKind, type LeaveBalance,
} from '@/lib/leave-balance'
import { balancesByEmployee, loadBalanceData } from '@/lib/leave-balance.server'

export const dynamic = 'force-dynamic'

// 연차 관리 (207) — 인사·총무. API_OWNERS: /api/attendance/balance → hr (GET 조회 · 그 외 수정)
// GET ?year=YYYY[&recommend=1]
//   rows: 그해 부여가 있거나 차감 휴가를 쓴 재직 직원별 잔여 (사용 순서: 기본 → 보상 → 초과)
//   grants: 그해 부여 원장(취소 포함) · employees: 양식용 재직 직원 목록
//   recommend=1: 연초 정리 — 재직 직원별 그해 기본 연차 추천 + 지난해 보상 잔여(이월 추천) + 지난해 기본 잔여(소멸)
// POST action:
//   grant_add { employee_id, kind, days, grant_date, reason } — 보상 · 조정은 사유 필수, 조정만 음수 허용
//   grant_cancel { id, note } — 지우지 않고 취소 상태로 (사유 필수)
//   recommend_confirm { year, items: [{ employee_id, base_days?, carry_days? }] } — 체크한 행만 부여로 확정

const MIGRATION_HINT = '207 마이그레이션(연차 관리)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KINDS: GrantKind[] = ['base', 'comp', 'carry', 'adjust']

type Emp = { id: string; name: string; team: string | null; position: string | null; hire_date: string | null; auth_user_id: string | null }

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!(me.isMaster || can(me, 'hr', 'view'))) {
    return NextResponse.json({ error: '연차 관리는 인사 · 총무 조회 권한이 필요합니다. 권한은 마스터 계정에 요청하세요.' }, { status: 403 })
  }
  const admin = createAdminClient()
  const thisYear = Number(kstToday().slice(0, 4))
  const year = Number(req.nextUrl.searchParams.get('year')) || thisYear
  const wantRecommend = req.nextUrl.searchParams.get('recommend') === '1'

  const { data: empData, error: eErr } = await admin.from('employees')
    .select('id, name, team, position, hire_date, auth_user_id').eq('is_active', true).order('name')
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })
  const emps = (empData ?? []) as Emp[]
  const byId = new Map(emps.map(e => [e.id, e]))

  const d = await loadBalanceData(admin, year)
  if (!d.ready) return NextResponse.json({ error: MIGRATION_HINT, ready: false }, { status: 200 })

  // 대상: 그해 유효 부여가 있거나 차감 휴가를 쓴 재직 직원
  const targetIds = Array.from(new Set([
    ...d.grants.filter(g => g.status === 'active').map(g => g.employee_id),
    ...d.leaves.map(l => l.employee_id),
  ])).filter(id => byId.has(id))
  const bal = balancesByEmployee(d, year, targetIds)
  const rows = targetIds.map(id => {
    const e = byId.get(id)!
    return { employee_id: id, name: e.name, team: e.team, position: e.position, hire_date: e.hire_date, has_login: !!e.auth_user_id, ...bal.get(id)! }
  }).sort((a, b) => (a.hire_date ?? '9999').localeCompare(b.hire_date ?? '9999') || a.name.localeCompare(b.name, 'ko'))

  // 부여 원장에 이름 붙이기 (퇴사 · 삭제된 직원은 별도 조회)
  const nameIds = Array.from(new Set(d.grants.flatMap(g => {
    const x = g as unknown as { employee_id: string; created_by?: string | null; canceled_by?: string | null }
    return [x.employee_id, x.created_by, x.canceled_by].filter((v): v is string => !!v)
  }))).filter(id => !byId.has(id))
  const names = new Map(emps.map(e => [e.id, e.name]))
  for (let i = 0; i < nameIds.length; i += 150) {
    const { data } = await admin.from('employees').select('id, name').in('id', nameIds.slice(i, i + 150))
    for (const e of data ?? []) names.set(e.id as string, e.name as string)
  }
  const grants = d.grants.map(g => {
    const x = g as unknown as { created_by?: string | null; canceled_by?: string | null }
    return {
      ...g,
      employee_name: names.get(g.employee_id) ?? null,
      created_by_name: x.created_by ? names.get(x.created_by) ?? null : null,
      canceled_by_name: x.canceled_by ? names.get(x.canceled_by) ?? null : null,
    }
  }).sort((a, b) => b.grant_date.localeCompare(a.grant_date) || b.created_at.localeCompare(a.created_at))

  let recommend: unknown[] | undefined
  if (wantRecommend) {
    // 지난해 잔여: 보상 → 이월 추천, 기본 → 소멸
    const prev = await loadBalanceData(admin, year - 1)
    const prevIds = emps.map(e => e.id)
    const prevBal: Map<string, LeaveBalance> = prev.ready ? balancesByEmployee(prev, year - 1, prevIds) : new Map()
    const hadPrevGrant = new Set(prev.grants.filter(g => g.status === 'active').map(g => g.employee_id))
    const baseExists = new Set(d.grants.filter(g => g.status === 'active' && g.kind === 'base').map(g => g.employee_id))
    const carryExists = new Set(d.grants.filter(g => g.status === 'active' && g.kind === 'carry').map(g => g.employee_id))
    recommend = emps.map(e => {
      const rec = recommendBase(e.hire_date, year)
      const pb = prevBal.get(e.id)
      return {
        employee_id: e.id, name: e.name, team: e.team, position: e.position, hire_date: e.hire_date, has_login: !!e.auth_user_id,
        managed: hadPrevGrant.has(e.id) || targetIds.includes(e.id),   // 지난해 · 올해 연차 대상이었는지 (기본 체크)
        base_days: rec.days, years: rec.years, rule: rec.rule,
        carry_days: pb && pb.remainComp > 0 ? pb.remainComp : 0,
        expire_days: pb ? pb.remainBase : 0,
        prev_over: pb ? pb.over : 0,
        base_exists: baseExists.has(e.id), carry_exists: carryExists.has(e.id),
      }
    })
  }

  // 드릴다운용 — 대상 직원의 그해 차감 휴가 (그해 안 근무일 수)
  const leaves = d.leaves.filter(l => byId.has(l.employee_id)).map(l => ({
    id: l.id, employee_id: l.employee_id, leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date,
    source: l.source ?? 'request', days: leaveDays(l, `${year}-01-01`, `${year}-12-31`, d.holidays),
  })).sort((a, b) => a.start_date.localeCompare(b.start_date))

  return NextResponse.json({
    ready: true, year, thisYear, rows, grants, recommend, leaves,
    employees: emps.map(e => ({ id: e.id, name: e.name, team: e.team, position: e.position, has_login: !!e.auth_user_id })),
    can_edit: isHrAdmin(me),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isHrAdmin(me)) {
    return NextResponse.json({ error: '연차 부여 · 취소는 인사 · 총무 수정 권한이 필요합니다. 권한은 마스터 계정에 요청하세요.' }, { status: 403 })
  }
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  const action = str('action')

  if (action === 'grant_add') {
    const employeeId = str('employee_id')
    const kind = str('kind') as GrantKind
    const days = Number(body.days)
    const grantDate = str('grant_date')
    const reason = str('reason')
    if (!employeeId) return NextResponse.json({ error: '직원을 고르세요.' }, { status: 400 })
    if (!KINDS.includes(kind)) return NextResponse.json({ error: '구분이 올바르지 않습니다.' }, { status: 400 })
    if (!DATE_RE.test(grantDate)) return NextResponse.json({ error: '날짜 형식은 YYYY-MM-DD' }, { status: 400 })
    if (!days || !isHalfStep(days)) return NextResponse.json({ error: '일수는 0.5 단위로 입력하세요(0 제외).' }, { status: 400 })
    if (kind !== 'adjust' && days < 0) return NextResponse.json({ error: '음수는 "조정"으로만 넣을 수 있습니다.' }, { status: 400 })
    if ((kind === 'comp' || kind === 'adjust') && !reason) {
      return NextResponse.json({ error: `${GRANT_KIND_LABEL[kind]} 연차는 사유를 입력해야 합니다.` }, { status: 400 })
    }
    const { error } = await admin.from('attendance_leave_grants').insert({
      employee_id: employeeId, year: Number(grantDate.slice(0, 4)), kind, days, grant_date: grantDate,
      reason: reason || null, source: 'manual', created_by: me.employeeId,
    })
    if (error) return NextResponse.json({ error: /attendance_leave_grants/.test(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'grant_cancel') {
    const id = str('id')
    const note = str('note')
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    if (!note) return NextResponse.json({ error: '취소 사유를 입력하세요.' }, { status: 400 })
    const { error } = await admin.from('attendance_leave_grants').update({
      status: 'canceled', canceled_by: me.employeeId, canceled_at: new Date().toISOString(), cancel_note: note,
    }).eq('id', id).eq('status', 'active')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'recommend_confirm') {
    const year = Number(body.year)
    const items = Array.isArray(body.items) ? body.items as { employee_id?: string; base_days?: number | null; carry_days?: number | null; rule?: string }[] : []
    if (!year || year < 2020 || year > 2100) return NextResponse.json({ error: '연도가 올바르지 않습니다.' }, { status: 400 })
    if (!items.length) return NextResponse.json({ error: '확정할 직원을 체크하세요.' }, { status: 400 })
    // 이미 있는 기본 · 이월은 건너뛴다 (두 번 확정 방지 — 바꾸려면 기존 부여를 취소하고 다시)
    const { data: exist, error: xErr } = await admin.from('attendance_leave_grants')
      .select('employee_id, kind').eq('year', year).eq('status', 'active').in('kind', ['base', 'carry'])
    if (xErr) return NextResponse.json({ error: MIGRATION_HINT }, { status: 500 })
    const has = new Set((exist ?? []).map(x => `${x.employee_id}:${x.kind}`))
    const rows: Record<string, unknown>[] = []
    let skipped = 0
    for (const it of items) {
      if (!it.employee_id) continue
      const b = Number(it.base_days), c = Number(it.carry_days)
      if (b > 0) {
        if (!isHalfStep(b)) return NextResponse.json({ error: '기본 연차는 0.5 단위로 입력하세요.' }, { status: 400 })
        if (has.has(`${it.employee_id}:base`)) skipped++
        else rows.push({ employee_id: it.employee_id, year, kind: 'base', days: b, grant_date: `${year}-01-01`,
          reason: `${year}년 기본 연차${it.rule ? ` (${it.rule})` : ''}`, source: 'recommend', created_by: me.employeeId })
      }
      if (c > 0) {
        if (!isHalfStep(c)) return NextResponse.json({ error: '이월 일수는 0.5 단위로 입력하세요.' }, { status: 400 })
        if (has.has(`${it.employee_id}:carry`)) skipped++
        else rows.push({ employee_id: it.employee_id, year, kind: 'carry', days: c, grant_date: `${year}-01-01`,
          reason: `${year - 1}년 보상 연차 이월`, source: 'recommend', created_by: me.employeeId })
      }
    }
    if (rows.length) {
      const { error } = await admin.from('attendance_leave_grants').insert(rows)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, inserted: rows.length, skipped })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
