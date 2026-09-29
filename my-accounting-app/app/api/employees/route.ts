import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser, loginIdToEmail, type CurrentUser } from '@/lib/user-role'
import { can, GROUP_KEYS, type PermLevel, type Permissions } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// 직원·계정·권한 관리 (인사·총무 수정 권한. 권한 편집은 마스터만)
// GET: 직원 목록 (+ 권한 필드, 호출자가 마스터인지)
// POST body.action:
//   create       { name, team?, position?, phone?, hire_date?, role, login_id?, password? }
//                — login_id+password가 있으면 로그인 계정 발급 (ID 방식)
//   update       { id, ...fields }  — login_id 변경 시 인증 계정도 함께 갱신
//   set_password { id, password }   — 관리자 비밀번호 재설정
//   deactivate / reactivate { id }  — 재직 상태 + 로그인 차단/해제
//   delete       { id }             — 직원·계정 완전 삭제 (배정 이력도 함께 삭제)
//   set_permissions { id, team, employment_type, work_start, work_end, is_master, permissions,
//                     can_approve, can_view_salary, can_view_payment_info, note }
//                — 마스터만. 변경 전·후를 employee_permission_logs에 남긴다.
//                  자기 자신의 마스터 해제 불가.
//   permission_logs { id } — 해당 직원의 권한 변경 이력

const ROLES = ['sales', 'manager', 'admin'] as const
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/  // 3~30자, 영문소문자·숫자·._-
const PERM_FIELDS = 'team, employment_type, work_start, work_end, is_master, permissions, can_approve, can_view_salary, can_view_payment_info'

const guard = async (level: PermLevel = 'edit'): Promise<{ error: string; status: number } | { me: CurrentUser }> => {
  const me = await getCurrentUser()
  if (!me) return { error: '로그인이 필요합니다.', status: 401 }
  if (!(me.isMaster || can(me, 'hr', level))) {
    return { error: level === 'edit' ? '인사·총무 수정 권한이 필요합니다.' : '인사·총무 조회 권한이 필요합니다.', status: 403 }
  }
  return { me }
}

export async function GET() {
  const g = await guard('view')
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })
  const admin = createAdminClient()
  const first = await admin
    .from('employees')
    .select(`id, name, position, phone, email, hire_date, role, is_active, auth_user_id, login_id, created_at, ${PERM_FIELDS}`)
    .order('is_active', { ascending: false })
    .order('name')
  let data: Record<string, unknown>[] | null = first.data as Record<string, unknown>[] | null
  let error = first.error
  let permissionsReady = true
  if (error) {
    // 109 미적용 — 레거시 컬럼으로 재조회
    permissionsReady = false
    const r = await admin
      .from('employees')
      .select('id, name, team, position, phone, email, hire_date, role, is_active, auth_user_id, login_id, created_at')
      .order('is_active', { ascending: false })
      .order('name')
    data = r.data as Record<string, unknown>[] | null; error = r.error
  }
  if (error) {
    const missing = /column|role|auth_user_id|login_id/i.test(error.message)
    return NextResponse.json({
      error: missing ? '103·104 마이그레이션(직원 확장)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.' : error.message,
    }, { status: 500 })
  }
  return NextResponse.json({
    employees: data ?? [],
    permissionsReady,
    me: { employeeId: g.me.employeeId, isMaster: g.me.isMaster, canEdit: g.me.isMaster || can(g.me, 'hr', 'edit') },
  })
}

export async function POST(req: NextRequest) {
  const g = await guard('edit')
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status })
  const admin = createAdminClient()
  const raw = await req.json().catch(() => ({})) as Record<string, unknown>
  const body = raw as Record<string, string | undefined>   // 레거시 액션은 문자열 필드만 쓴다
  const action = body.action

  // ── 권한 편집 (마스터만) ─────────────────────────────
  if (action === 'set_permissions') {
    if (!g.me.isMaster) return NextResponse.json({ error: '권한 편집은 마스터 계정만 할 수 있습니다.' }, { status: 403 })
    const id = String(raw.id ?? '')
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { data: before, error: bErr } = await admin.from('employees')
      .select(`id, name, ${PERM_FIELDS}`).eq('id', id).maybeSingle()
    if (bErr || !before) return NextResponse.json({ error: bErr?.message ?? '직원을 찾을 수 없습니다.' }, { status: 404 })

    const levels: PermLevel[] = ['none', 'view', 'edit']
    const rawPerm = (raw.permissions ?? {}) as Record<string, unknown>
    const permissions: Permissions = {}
    for (const k of GROUP_KEYS) {
      const v = rawPerm[k]
      permissions[k] = levels.includes(v as PermLevel) ? (v as PermLevel) : 'none'
    }
    if (permissions.mgmt === 'edit') permissions.mgmt = 'view'   // 경영 현황은 조회만
    const team = typeof raw.team === 'string' && raw.team.trim() ? raw.team.trim() : null
    const employment = raw.employment_type === 'parttime' ? 'parttime' : 'regular'
    const dateOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null
    const isMaster = raw.is_master === true
    if (before.id === g.me.employeeId && before.is_master && !isMaster) {
      return NextResponse.json({ error: '자기 자신의 마스터 권한은 해제할 수 없습니다.' }, { status: 400 })
    }
    const after = {
      team, employment_type: employment,
      work_start: dateOrNull(raw.work_start), work_end: dateOrNull(raw.work_end),
      is_master: isMaster, permissions,
      can_approve: raw.can_approve === true,
      can_view_salary: raw.can_view_salary === true,
      can_view_payment_info: raw.can_view_payment_info === true,
    }
    const { error: uErr } = await admin.from('employees').update(after).eq('id', id)
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
    const beforeState: Record<string, unknown> = { ...(before as Record<string, unknown>) }
    delete beforeState.id
    delete beforeState.name
    await admin.from('employee_permission_logs').insert({
      employee_id: id, changed_by: g.me.employeeId,
      before_state: beforeState, after_state: after,
      note: typeof raw.note === 'string' ? raw.note : null,
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'permission_logs') {
    const id = String(body.id ?? '')
    const { data, error } = await admin.from('employee_permission_logs')
      .select('id, changed_at, before_state, after_state, note, changer:employees!employee_permission_logs_changed_by_fkey(name)')
      .eq('employee_id', id).order('changed_at', { ascending: false }).limit(30)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ logs: data ?? [] })
  }

  const normRole = (r: string | undefined) =>
    (ROLES as readonly string[]).includes(r ?? '') ? (r as string) : 'sales'

  if (action === 'create') {
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: '이름이 필요합니다.' }, { status: 400 })
    const loginId = (body.login_id ?? '').trim().toLowerCase()
    const password = body.password ?? ''

    let authUserId: string | null = null
    if (loginId) {
      if (!LOGIN_ID_RE.test(loginId)) {
        return NextResponse.json({ error: 'ID는 3~30자의 영문 소문자·숫자·마침표(._-)만 가능합니다.' }, { status: 400 })
      }
      if (!password) return NextResponse.json({ error: '계정을 발급하려면 비밀번호를 입력하세요.' }, { status: 400 })
      const { data: created, error: aErr } = await admin.auth.admin.createUser({
        email: loginIdToEmail(loginId), password, email_confirm: true,
      })
      if (aErr) {
        const msg = /password/i.test(aErr.message)
          ? `비밀번호가 인증 서버 최소 기준(기본 6자)에 미달합니다: ${aErr.message}`
          : /already/i.test(aErr.message) ? '이미 사용 중인 ID입니다.' : aErr.message
        return NextResponse.json({ error: `계정 생성 실패: ${msg}` }, { status: 400 })
      }
      authUserId = created.user?.id ?? null
    }

    const fields = {
      name, team: (body.team ?? '').trim() || null,
      position: (body.position ?? '').trim() || null,
      phone: (body.phone ?? '').trim() || null,
      hire_date: (body.hire_date ?? '').trim() || null,
      role: normRole(body.role), login_id: loginId || null,
      auth_user_id: authUserId, is_active: true,
    }

    // 같은 이름의 계정 없는 기존 직원(담당 배정용으로만 등록)이 있으면 그 행을 확장
    const { data: exist } = await admin.from('employees')
      .select('id').eq('name', name).eq('is_active', true).is('auth_user_id', null).maybeSingle()
    if (exist) {
      const { error } = await admin.from('employees').update(fields).eq('id', exist.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, merged: true })
    }
    const { error } = await admin.from('employees').insert(fields)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'update') {
    const id = body.id
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { data: cur, error: cErr } = await admin.from('employees')
      .select('auth_user_id, login_id').eq('id', id).single()
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

    const patch: Record<string, string | null> = {}
    for (const k of ['name', 'team', 'position', 'phone', 'hire_date'] as const) {
      if (k in body) patch[k] = (body[k] ?? '').trim() || null
    }
    if ('role' in body) patch.role = normRole(body.role)
    if ('login_id' in body) {
      const newId = (body.login_id ?? '').trim().toLowerCase()
      if (newId && !LOGIN_ID_RE.test(newId)) {
        return NextResponse.json({ error: 'ID는 3~30자의 영문 소문자·숫자·마침표(._-)만 가능합니다.' }, { status: 400 })
      }
      patch.login_id = newId || null
      // 인증 계정이 있으면 로그인 이메일도 함께 변경
      if (newId && cur.auth_user_id && newId !== cur.login_id) {
        const { error: uErr } = await admin.auth.admin.updateUserById(cur.auth_user_id as string, {
          email: loginIdToEmail(newId), email_confirm: true,
        })
        if (uErr) return NextResponse.json({ error: `ID 변경 실패: ${uErr.message}` }, { status: 400 })
      }
    }
    const { error } = await admin.from('employees').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_password') {
    const id = body.id
    const password = body.password ?? ''
    if (!id || !password) return NextResponse.json({ error: 'id와 비밀번호가 필요합니다.' }, { status: 400 })
    const { data: emp, error: e1 } = await admin.from('employees')
      .select('auth_user_id, login_id').eq('id', id).single()
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    // ID만 기재되고 인증 계정이 없는 직원: 이 자리에서 계정을 발급하고 연결
    if (!emp.auth_user_id) {
      if (!emp.login_id) return NextResponse.json({ error: '로그인 ID가 없는 직원입니다. 먼저 수정에서 ID를 입력하세요.' }, { status: 400 })
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: loginIdToEmail(emp.login_id as string),
        password,
        email_confirm: true,
      })
      if (cErr || !created?.user) {
        const msg = /password/i.test(cErr?.message ?? '')
          ? '비밀번호가 인증 서버 최소 기준(기본 6자)에 미달합니다.'
          : /already|exists|registered/i.test(cErr?.message ?? '')
            ? '이미 같은 ID의 인증 계정이 존재합니다. 다른 ID로 변경 후 다시 시도하세요.'
            : (cErr?.message ?? '계정 생성 실패')
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      const { error: lErr } = await admin.from('employees')
        .update({ auth_user_id: created.user.id }).eq('id', id)
      if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
      return NextResponse.json({ ok: true, issued: true })
    }
    const { error } = await admin.auth.admin.updateUserById(emp.auth_user_id as string, { password })
    if (error) {
      const msg = /password/i.test(error.message)
        ? `비밀번호가 인증 서버 최소 기준(기본 6자)에 미달합니다.` : error.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'deactivate' || action === 'reactivate') {
    const id = body.id
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const active = action === 'reactivate'
    const { data: emp, error: e1 } = await admin.from('employees')
      .select('auth_user_id').eq('id', id).single()
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    const { error } = await admin.from('employees').update({ is_active: active }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (emp?.auth_user_id) {
      await admin.auth.admin.updateUserById(emp.auth_user_id as string, {
        ban_duration: active ? 'none' : '87600h',  // 10년 = 사실상 무기한
      })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'bulk_delete') {
    const ids = body.ids as unknown
    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ error: '삭제할 직원을 선택하세요.' }, { status: 400 })
    }
    const me = await getCurrentUser()
    // 본인 계정은 목록에서 제외하고 진행
    const targetIds = (ids as string[]).filter(id => id !== me?.employeeId)
    const skippedSelf = ids.length - targetIds.length
    if (!targetIds.length) {
      return NextResponse.json({ error: '본인 계정은 삭제할 수 없습니다.' }, { status: 400 })
    }
    const { data: emps, error: e1 } = await admin.from('employees')
      .select('id, auth_user_id').in('id', targetIds)
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    // 직원 행 삭제 (거래처 배정은 FK CASCADE) → 인증 계정 삭제
    const { error } = await admin.from('employees').delete().in('id', targetIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const emp of emps ?? []) {
      if (emp.auth_user_id) await admin.auth.admin.deleteUser(emp.auth_user_id as string)
    }
    return NextResponse.json({ ok: true, deleted: targetIds.length, skipped_self: skippedSelf })
  }

  if (action === 'delete') {
    const id = body.id
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const me = await getCurrentUser()
    const { data: emp, error: e1 } = await admin.from('employees')
      .select('auth_user_id, name').eq('id', id).single()
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    if (me?.employeeId === id) return NextResponse.json({ error: '본인 계정은 삭제할 수 없습니다.' }, { status: 400 })
    // 직원 행 삭제 (거래처 배정은 FK CASCADE로 함께 삭제) → 인증 계정 삭제
    const { error } = await admin.from('employees').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (emp?.auth_user_id) await admin.auth.admin.deleteUser(emp.auth_user_id as string)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
