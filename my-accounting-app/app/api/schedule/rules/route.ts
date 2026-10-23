import { NextRequest, NextResponse } from 'next/server'
import { can, isHrAdmin } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { RULE_CATEGORIES, type RuleCategory } from '@/lib/schedule'

export const dynamic = 'force-dynamic'

// 스케줄 관리 규칙 (schedule_rules, 202)
// GET  — 목록. 회계 조회 권한이 없으면 finance_only 건은 빼고 내려준다.
// POST — 인사·총무 수정 권한. action: create | update | delete
//   세무·급여처럼 금액이 걸린 규칙(finance_only)은 회계 조회 권한도 함께 있어야 수정할 수 있다.

const MIGRATION_HINT = '202 마이그레이션(스케줄 관리 규칙)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missingTable = (msg: string) => /schedule_rules|relation .* does not exist/i.test(msg)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SHIFTS = ['prev', 'next', 'none']
const KINDS = ['monthly', 'yearly', 'once']

const COLS = 'id, title, category, repeat_kind, repeat_day, repeat_month, on_date, end_date, holiday_shift, amount, employee_id, finance_only, active, memo, created_at'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const admin = createAdminClient()
  const showMoney = can(me, 'accounting', 'view')
  let q = admin.from('schedule_rules').select(COLS)
    .order('active', { ascending: false }).order('category').order('title')
  if (!showMoney) q = q.eq('finance_only', false)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: missingTable(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
  }
  return NextResponse.json({
    rules: data ?? [], showMoney, can_edit: isHrAdmin(me),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isHrAdmin(me)) return NextResponse.json({ error: '인사·총무 수정 권한이 필요합니다.' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')

  if (action === 'delete') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    // 회계 전용 규칙은 회계 조회 권한도 있어야 건드릴 수 있다
    const { data: cur, error: cErr } = await admin.from('schedule_rules')
      .select('finance_only').eq('id', id).single()
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
    if (cur.finance_only && !can(me, 'accounting', 'view')) {
      return NextResponse.json({ error: '회계 일정은 회계 권한자만 수정할 수 있습니다.' }, { status: 403 })
    }
    const { error } = await admin.from('schedule_rules').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action !== 'create' && action !== 'update') {
    return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
  }

  const title = String(body.title ?? '').trim()
  const category = String(body.category ?? 'other') as RuleCategory
  const repeatKind = String(body.repeat_kind ?? 'monthly')
  const shift = String(body.holiday_shift ?? 'next')
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
  if (!RULE_CATEGORIES.includes(category)) return NextResponse.json({ error: '구분이 올바르지 않습니다.' }, { status: 400 })
  if (!KINDS.includes(repeatKind)) return NextResponse.json({ error: '반복 종류가 올바르지 않습니다.' }, { status: 400 })
  if (!SHIFTS.includes(shift)) return NextResponse.json({ error: '휴일 처리가 올바르지 않습니다.' }, { status: 400 })

  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  }
  const day = num(body.repeat_day)
  const mon = num(body.repeat_month)
  const onDate = String(body.on_date ?? '').trim()
  const endDate = String(body.end_date ?? '').trim()

  if (repeatKind === 'monthly' && (!day || day > 31)) {
    return NextResponse.json({ error: '매월 반복은 일자(1~31, 31=말일)가 필요합니다.' }, { status: 400 })
  }
  if (repeatKind === 'yearly' && (!day || day > 31 || !mon || mon > 12)) {
    return NextResponse.json({ error: '매년 반복은 월과 일자가 필요합니다.' }, { status: 400 })
  }
  if (repeatKind === 'once') {
    if (!DATE_RE.test(onDate)) return NextResponse.json({ error: '날짜를 입력하세요.' }, { status: 400 })
    if (endDate && (!DATE_RE.test(endDate) || endDate < onDate)) {
      return NextResponse.json({ error: '종료일이 시작일보다 빠릅니다.' }, { status: 400 })
    }
  }

  const financeOnly = body.finance_only === true
  if (financeOnly && !can(me, 'accounting', 'view')) {
    return NextResponse.json({ error: '회계 전용 일정은 회계 권한자만 등록할 수 있습니다.' }, { status: 403 })
  }

  const fields = {
    title, category,
    repeat_kind: repeatKind,
    repeat_day: repeatKind === 'once' ? null : day,
    repeat_month: repeatKind === 'yearly' ? mon : null,
    on_date: repeatKind === 'once' ? onDate : null,
    end_date: repeatKind === 'once' && endDate ? endDate : null,
    holiday_shift: repeatKind === 'once' ? 'none' : shift,   // 1회성은 사람이 정한 날짜 그대로
    amount: num(body.amount),
    employee_id: String(body.employee_id ?? '').trim() || null,
    finance_only: financeOnly,
    active: body.active !== false,
    memo: String(body.memo ?? '').trim() || null,
    updated_at: new Date().toISOString(),
  }

  if (action === 'create') {
    const { error } = await admin.from('schedule_rules')
      .insert({ ...fields, created_by: me.employeeId })
    if (error) {
      return NextResponse.json({ error: missingTable(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  const { data: cur, error: cErr } = await admin.from('schedule_rules')
    .select('finance_only').eq('id', id).single()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (cur.finance_only && !can(me, 'accounting', 'view')) {
    return NextResponse.json({ error: '회계 일정은 회계 권한자만 수정할 수 있습니다.' }, { status: 403 })
  }
  const { error } = await admin.from('schedule_rules').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
