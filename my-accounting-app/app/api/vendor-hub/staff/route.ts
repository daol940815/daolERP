import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// 자사 담당직원 — 직원 마스터 + 거래처 배정
// GET  /api/vendor-hub/staff              → 활성 직원 목록(담당처 수 포함)
// POST /api/vendor-hub/staff  body.action:
//   create_employee { name, team? }                          직원 등록
//   assign          { vendor_id, employee_id, is_primary? }  배정 (신규 직원이면 name으로 생성)
//   assign_new      { vendor_id, name, team?, is_primary? }  직원 등록 + 배정
//   set_primary     { assignment_id }                        주담당 변경
//   unassign        { assignment_id }                        배정 종료(ended_at)
export async function GET() {
  const admin = createAdminClient()
  const { data: emps, error } = await admin
    .from('employees').select('id, name, team, is_active').eq('is_active', true).order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: asgn } = await admin.from('vendor_staff').select('employee_id').is('ended_at', null)
  const counts = new Map<string, number>()
  for (const a of asgn ?? []) counts.set(a.employee_id, (counts.get(a.employee_id) ?? 0) + 1)
  return NextResponse.json({
    employees: (emps ?? []).map(e => ({ ...e, vendor_count: counts.get(e.id) ?? 0 })),
  })
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | boolean | undefined>
  const action = body.action as string

  const clearPrimary = async (vendorId: string) => {
    await admin.from('vendor_staff').update({ is_primary: false })
      .eq('vendor_id', vendorId).is('ended_at', null).eq('is_primary', true)
  }

  if (action === 'create_employee') {
    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: '이름이 필요합니다.' }, { status: 400 })
    const { data, error } = await admin.from('employees')
      .insert({ name, team: String(body.team ?? '').trim() || null })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, employee: data })
  }

  if (action === 'assign' || action === 'assign_new') {
    const vendorId = String(body.vendor_id ?? '')
    if (!vendorId) return NextResponse.json({ error: 'vendor_id가 필요합니다.' }, { status: 400 })
    let employeeId = String(body.employee_id ?? '')
    if (action === 'assign_new') {
      const name = String(body.name ?? '').trim()
      if (!name) return NextResponse.json({ error: '이름이 필요합니다.' }, { status: 400 })
      // 같은 이름의 활성 직원이 있으면 재사용 (중복 마스터 방지)
      const { data: exist } = await admin.from('employees')
        .select('id').eq('name', name).eq('is_active', true).maybeSingle()
      if (exist) employeeId = exist.id
      else {
        const { data, error } = await admin.from('employees')
          .insert({ name, team: String(body.team ?? '').trim() || null }).select('id').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        employeeId = data.id
      }
    }
    if (!employeeId) return NextResponse.json({ error: 'employee_id가 필요합니다.' }, { status: 400 })

    const { data: dup } = await admin.from('vendor_staff').select('id')
      .eq('vendor_id', vendorId).eq('employee_id', employeeId).is('ended_at', null).maybeSingle()
    if (dup) return NextResponse.json({ error: '이미 배정된 직원입니다.' }, { status: 400 })

    const isPrimary = body.is_primary === true
    if (isPrimary) await clearPrimary(vendorId)
    const { error } = await admin.from('vendor_staff').insert({
      vendor_id: vendorId, employee_id: employeeId,
      is_primary: isPrimary, started_at: new Date().toISOString().slice(0, 10),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_primary') {
    const id = String(body.assignment_id ?? '')
    const { data: row, error: e1 } = await admin.from('vendor_staff')
      .select('vendor_id').eq('id', id).single()
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    await clearPrimary(row.vendor_id)
    const { error } = await admin.from('vendor_staff').update({ is_primary: true }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'unassign') {
    const id = String(body.assignment_id ?? '')
    const { error } = await admin.from('vendor_staff')
      .update({ ended_at: new Date().toISOString().slice(0, 10), is_primary: false }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
