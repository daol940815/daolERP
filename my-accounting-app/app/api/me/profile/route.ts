import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { kstToday, kstMonthNow, monthRange } from '@/lib/attendance'

export const dynamic = 'force-dynamic'

// 내 정보 (내 업무 › 내 정보) — 본인 직원 행 + 계정 + 내 업무 요약을 1회 호출로.
//  GET   본인만. 권한 정보는 내려주지 않는다 (2026-10-01 사용자 결정: 직원이 자기 권한 범위를 볼 이유 없음).
//  PATCH { phone?, email? } — 본인이 고칠 수 있는 것은 연락처만 (사용자 확정). 팀·직위·입사일·로그인 ID는 인사·총무.
// 각 요약 블록은 200/300/700 마이그레이션 미적용 환경에서도 죽지 않도록 개별 폴백한다.

const EMP_COLS = 'id, name, team, position, employment_type, hire_date, work_start, work_end, is_active, phone, email, login_id'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const today = kstToday()
  const month = kstMonthNow()
  const [from, to] = monthRange(month)   // 월 첫날 ~ 말일 (lib/attendance)
  const empId = me.employeeId

  const none = Promise.resolve({ data: null, error: null })
  const empty = Promise.resolve({ data: [], error: null })

  const [empRes, authRes, attRes, leaveRes, staffRes, worklogRes, journalRes] = await Promise.all([
    empId ? admin.from('employees').select(EMP_COLS).eq('id', empId).maybeSingle() : none,
    admin.auth.admin.getUserById(me.userId).catch(() => ({ data: { user: null }, error: null })),
    empId ? admin.from('attendance_records').select('check_in_at, check_out_at').eq('employee_id', empId).eq('work_date', today).maybeSingle() : none,
    empId ? admin.from('attendance_leaves').select('id, leave_type, start_date, end_date, status, created_at')
      .eq('employee_id', empId).order('created_at', { ascending: false }).limit(5) : empty,
    empId ? admin.from('vendor_staff').select('vendor_id, is_primary, vendors(name, status)')
      .eq('employee_id', empId).is('ended_at', null) : empty,
    empId ? admin.from('erp_work_logs').select('id, work_date, action, category, content')
      .eq('employee_id', empId).gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).order('logged_at', { ascending: false }).limit(200) : empty,
    empId ? admin.from('contact_activities').select('id, activity_date, activity_type, content, contacts(name), vendors(name)')
      .eq('employee_id', empId).order('activity_date', { ascending: false }).order('created_at', { ascending: false }).limit(5) : empty,
  ])

  type Named = { name?: string | null; status?: string | null } | { name?: string | null; status?: string | null }[] | null
  const one = (v: Named) => (Array.isArray(v) ? v[0] : v) ?? null

  // 담당 거래처 (현재 담당, 주담당 먼저)
  const vendors = ((staffRes.data ?? []) as { vendor_id: string; is_primary: boolean; vendors: Named }[])
    .map(r => ({ vendor_id: r.vendor_id, name: one(r.vendors)?.name ?? '(거래처)', is_primary: r.is_primary, status: one(r.vendors)?.status ?? null }))
    .filter(v => v.status !== 'merged')
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name, 'ko'))

  // 담당 고객 — 내 담당 거래처에 현재 배정된 거래처 담당자(인물). 이름만 저장되고 존칭·직함은 화면에서 붙인다.
  let contacts: { contact_id: string; name: string; title: string | null; vendor_id: string; vendor_name: string; is_representative: boolean }[] = []
  const vendorIds = vendors.map(v => v.vendor_id)
  for (let i = 0; i < vendorIds.length; i += 150) {
    const chunk = vendorIds.slice(i, i + 150)
    const { data } = await admin.from('contact_assignments')
      .select('contact_id, vendor_id, title, is_representative, contacts(name), vendors(name)')
      .in('vendor_id', chunk).is('ended_at', null)
    for (const r of (data ?? []) as { contact_id: string; vendor_id: string; title: string | null; is_representative: boolean; contacts: Named; vendors: Named }[]) {
      contacts.push({
        contact_id: r.contact_id, name: one(r.contacts)?.name ?? '(이름 없음)', title: r.title,
        vendor_id: r.vendor_id, vendor_name: one(r.vendors)?.name ?? '', is_representative: r.is_representative,
      })
    }
  }
  contacts = contacts.sort((a, b) => a.vendor_name.localeCompare(b.vendor_name, 'ko') || Number(b.is_representative) - Number(a.is_representative))

  const worklogs = (worklogRes.data ?? []) as { id: string; work_date: string; action: string; category: string | null; content: string }[]
  const authUser = (authRes as { data: { user: { last_sign_in_at?: string | null } | null } }).data?.user ?? null

  return NextResponse.json({
    linked: !!empId,
    employee: empRes.data ?? null,
    account: { login_id: (empRes.data as { login_id?: string | null } | null)?.login_id ?? null, email: me.email, last_sign_in_at: authUser?.last_sign_in_at ?? null },
    today,
    month,
    attendance: attRes.error ? null : attRes.data ?? null,
    attendanceReady: !attRes.error,
    leaves: leaveRes.error ? [] : leaveRes.data ?? [],
    vendors,
    contacts,
    worklogCount: worklogRes.error ? null : worklogs.length,
    worklogs: worklogs.slice(0, 5),
    journal: ((journalRes.data ?? []) as { id: string; activity_date: string; activity_type: string; content: string; contacts: Named; vendors: Named }[])
      .map(a => ({ id: a.id, activity_date: a.activity_date, activity_type: a.activity_type, content: a.content, contact_name: one(a.contacts)?.name ?? null, vendor_name: one(a.vendors)?.name ?? null })),
  })
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { phone?: string | null; email?: string | null }
  const patch: { phone?: string | null; email?: string | null } = {}
  if ('phone' in body) {
    const v = (body.phone ?? '').trim()
    if (v && !/^[\d\-+() ]{7,20}$/.test(v)) return NextResponse.json({ error: '전화번호 형식이 올바르지 않습니다.' }, { status: 400 })
    patch.phone = v || null
  }
  if ('email' in body) {
    const v = (body.email ?? '').trim()
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 })
    patch.email = v || null
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경할 항목이 없습니다. (연락처만 본인 수정 가능)' }, { status: 400 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('employees').update(patch).eq('id', me.employeeId).select(EMP_COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, employee: data })
}
