import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 직원·계정 관리 (관리자 전용)
// GET: 직원 목록 (계정 발급 여부 포함)
// POST body.action:
//   create { name, team?, position?, phone?, email?, hire_date?, role, password? }
//     — email+password가 있으면 로그인 계정 발급까지. 같은 이름의 계정 없는
//     기존 직원(담당 배정용)이 있으면 새로 만들지 않고 그 행을 확장한다.
//   update { id, ...fields }
//   deactivate { id }  — 재직 상태 해제 + 로그인 차단
//   reactivate { id }

const guard = async () => {
  const me = await getCurrentUser()
  if (!me) return { error: '로그인이 필요합니다.', status: 401 }
  if (me.role !== 'admin') return { error: '관리자만 접근할 수 있습니다.', status: 403 }
  return null
}

export async function GET() {
  const g = await guard()
  if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('id, name, team, position, phone, email, hire_date, role, is_active, auth_user_id, created_at')
    .order('is_active', { ascending: false })
    .order('name')
  if (error) {
    const missing = /column|role|auth_user_id/i.test(error.message)
    return NextResponse.json({
      error: missing ? '103 마이그레이션(직원 확장)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.' : error.message,
    }, { status: 500 })
  }
  return NextResponse.json({ employees: data ?? [] })
}

export async function POST(req: NextRequest) {
  const g = await guard()
  if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | undefined>
  const action = body.action

  if (action === 'create') {
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: '이름이 필요합니다.' }, { status: 400 })
    const role = body.role === 'admin' ? 'admin' : 'sales'
    const email = (body.email ?? '').trim() || null
    const password = (body.password ?? '').trim()

    // 로그인 계정 발급 (이메일+비밀번호가 있을 때)
    let authUserId: string | null = null
    if (email && password) {
      if (password.length < 8) return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 })
      const { data: created, error: aErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      })
      if (aErr) return NextResponse.json({ error: `계정 생성 실패: ${aErr.message}` }, { status: 400 })
      authUserId = created.user?.id ?? null
    }

    const fields = {
      name, team: (body.team ?? '').trim() || null,
      position: (body.position ?? '').trim() || null,
      phone: (body.phone ?? '').trim() || null,
      email, hire_date: (body.hire_date ?? '').trim() || null,
      role, auth_user_id: authUserId, is_active: true,
    }

    // 같은 이름의 계정 없는 기존 직원(담당 배정용으로만 등록)이 있으면 그 행을 확장
    const { data: exist } = await admin.from('employees')
      .select('id, auth_user_id').eq('name', name).eq('is_active', true).is('auth_user_id', null).maybeSingle()
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
    const patch: Record<string, string | null> = {}
    for (const k of ['name', 'team', 'position', 'phone', 'email', 'hire_date', 'role'] as const) {
      if (k in body) patch[k] = (body[k] ?? '').trim() || null
    }
    if (patch.role && patch.role !== 'admin' && patch.role !== 'sales') delete patch.role
    const { error } = await admin.from('employees').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
    // 로그인 차단/해제 (계정이 있는 직원만)
    if (emp?.auth_user_id) {
      await admin.auth.admin.updateUserById(emp.auth_user_id as string, {
        ban_duration: active ? 'none' : '87600h',  // 10년 = 사실상 무기한
      })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
