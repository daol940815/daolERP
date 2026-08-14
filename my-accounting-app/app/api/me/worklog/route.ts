import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import {
  WORK_LOG_ACTIONS, WORK_LOG_CATEGORIES, WORK_LOG_MIGRATION_HINT,
  isWorkLogMissing, kstToday,
} from '@/lib/work-log'

export const dynamic = 'force-dynamic'

// 업무일지 — 계정의 ERP 업무 이력 (자동 기재 + ERP 밖 업무 직접 기재)
// GET    ?month=YYYY-MM&action=&employee=   — 기본 본인·이번 달. employee는 manager/admin만
// POST   { content, category, work_date }   — 직접 기재 (본인)
// PATCH  ?id=  { content, category }        — 직접 기재분만 수정 (본인)
// DELETE ?id=                               — 직접 기재분만 삭제 (본인)

const NOT_LINKED = '직원 정보와 연결되지 않은 계정입니다. 직원·계정 관리에서 연결 후 이용하세요.'
const AUTO_LOCKED = '자동 기재된 업무는 수정·삭제할 수 없습니다. (ERP 활동 기록)'

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const from = `${month}-01`
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { from, before: next }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams

  const month = /^\d{4}-\d{2}$/.test(sp.get('month') ?? '') ? sp.get('month')! : kstToday().slice(0, 7)
  const action = sp.get('action') ?? 'all'

  // 열람 대상 — 직원(sales)은 본인만, manager/admin은 팀원 지정 가능
  const requested = sp.get('employee')
  const targetId = requested && me.role !== 'sales' ? requested : me.employeeId
  if (!targetId) return NextResponse.json({ rows: [], employees: [], hint: NOT_LINKED, month, role: me.role })

  const { from, before } = monthRange(month)
  let query = admin.from('erp_work_logs')
    .select('id, work_date, logged_at, source, action, category, content, ref_type, ref_id')
    .eq('employee_id', targetId)
    .gte('work_date', from).lt('work_date', before)
    .order('work_date', { ascending: false })
    .order('logged_at', { ascending: false })
    .limit(1000)
  if (action !== 'all') query = query.eq('action', action)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({
      error: isWorkLogMissing(error.message) ? WORK_LOG_MIGRATION_HINT : error.message,
    }, { status: 500 })
  }

  // 유형별 건수 (KPI) — 필터와 무관하게 이번 달 전체 기준
  const { data: allRows } = await admin.from('erp_work_logs')
    .select('action').eq('employee_id', targetId)
    .gte('work_date', from).lt('work_date', before).limit(2000)
  const counts: Record<string, number> = {}
  for (const r of allRows ?? []) counts[r.action as string] = (counts[r.action as string] ?? 0) + 1

  // manager/admin 전환용 직원 목록
  let employees: { id: string; name: string }[] = []
  if (me.role !== 'sales') {
    const { data: emps } = await admin.from('employees')
      .select('id, name').eq('is_active', true).order('name')
    employees = (emps ?? []) as { id: string; name: string }[]
  }

  const target = employees.find(e => e.id === targetId)
  return NextResponse.json({
    rows: data ?? [], counts, month, employees, role: me.role,
    employee_id: targetId,
    employee_name: targetId === me.employeeId ? me.employeeName : (target?.name ?? null),
    is_self: targetId === me.employeeId,
    categories: WORK_LOG_CATEGORIES,
    actions: WORK_LOG_ACTIONS,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })

  const body = await req.json().catch(() => null) as
    { content?: string; category?: string; work_date?: string } | null
  const content = body?.content?.trim()
  if (!content) return NextResponse.json({ error: '업무 내용을 입력해주세요.' }, { status: 400 })

  const category = body?.category?.trim() || null
  if (category && !(WORK_LOG_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: '구분이 올바르지 않습니다.' }, { status: 400 })
  }
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.work_date ?? '') ? body!.work_date! : kstToday()

  const admin = createAdminClient()
  const { data, error } = await admin.from('erp_work_logs').insert({
    employee_id: me.employeeId,
    work_date: workDate,
    source: 'manual',
    action: '직접기재',
    category,
    content,
  }).select('id').single()
  if (error) {
    return NextResponse.json({
      error: isWorkLogMissing(error.message) ? WORK_LOG_MIGRATION_HINT : error.message,
    }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const body = await req.json().catch(() => null) as
    { content?: string; category?: string; work_date?: string } | null
  const content = body?.content?.trim()
  if (!content) return NextResponse.json({ error: '업무 내용을 입력해주세요.' }, { status: 400 })
  const category = body?.category?.trim() || null
  if (category && !(WORK_LOG_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: '구분이 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createAdminClient()
  // 본인 + 직접 기재분만 — 조건 불일치는 0건 갱신 (자동 기재·타인 기록 보호)
  const { data, error } = await admin.from('erp_work_logs')
    .update({
      content, category,
      ...(/^\d{4}-\d{2}-\d{2}$/.test(body?.work_date ?? '') ? { work_date: body!.work_date! } : {}),
    })
    .eq('id', id).eq('employee_id', me.employeeId).eq('source', 'manual')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: AUTO_LOCKED }, { status: 403 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('erp_work_logs')
    .delete()
    .eq('id', id).eq('employee_id', me.employeeId).eq('source', 'manual')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: AUTO_LOCKED }, { status: 403 })
  return NextResponse.json({ ok: true })
}
