import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 내 영업일지 — 본인(contact_activities.employee_id) 기록만 다룬다.
// GET  /api/me/journal                  — 내 기록 목록 (최근 100건)
// GET  /api/me/journal?search_contact=… — 작성용 인물 검색 (현재 소속 거래처 포함)
// POST — 기록 작성 (employee_id는 서버에서 본인으로 강제)
// DELETE ?id=… — 내 기록 삭제 (본인 것만)

const NOT_LINKED = '직원 정보와 연결되지 않은 계정입니다. 직원·계정 관리에서 연결 후 이용하세요.'

type NameRef = { name: string } | { name: string }[] | null
const one = (v: NameRef) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  // 인물 검색 — 이름 부분 일치, 병합된 인물 제외, 현재 배정 거래처를 함께 반환
  const q = req.nextUrl.searchParams.get('search_contact')?.trim()
  if (q) {
    const { data, error } = await admin
      .from('contacts')
      .select('id, name, phone, contact_assignments(vendor_id, ended_at, vendors(name))')
      .is('merged_into_id', null)
      .ilike('name', `%${q}%`)
      .order('name')
      .limit(20)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    type Asgn = { vendor_id: string; ended_at: string | null; vendors: NameRef }
    return NextResponse.json({
      contacts: (data ?? []).map(c => {
        const current = ((c.contact_assignments ?? []) as Asgn[]).find(a => !a.ended_at)
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          vendor_id: current?.vendor_id ?? null,
          vendor_name: current ? one(current.vendors) : null,
        }
      }),
    })
  }

  if (!me.employeeId) return NextResponse.json({ rows: [], hint: NOT_LINKED })

  const { data, error } = await admin
    .from('contact_activities')
    .select('id, contact_id, vendor_id, activity_date, activity_type, content, next_action, created_at, contacts(name), vendors(name)')
    .eq('employee_id', me.employeeId)
    .order('activity_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    id: string; contact_id: string; vendor_id: string | null
    activity_date: string; activity_type: string
    content: string; next_action: string | null; created_at: string
    contacts: NameRef; vendors: NameRef
  }
  return NextResponse.json({
    rows: ((data ?? []) as Row[]).map(a => ({
      id: a.id,
      contact_id: a.contact_id,
      vendor_id: a.vendor_id,
      activity_date: a.activity_date,
      activity_type: a.activity_type,
      content: a.content,
      next_action: a.next_action,
      contact_name: one(a.contacts),
      vendor_name: one(a.vendors),
    })),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })

  const body = await req.json().catch(() => null) as {
    contact_id?: string; vendor_id?: string; activity_date?: string
    activity_type?: string; content?: string; next_action?: string
  } | null
  if (!body?.contact_id || !body.content?.trim()) {
    return NextResponse.json({ error: '인물(contact_id)과 내용(content)이 필요합니다.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('contact_activities').insert({
    contact_id: body.contact_id,
    vendor_id: body.vendor_id || null,
    employee_id: me.employeeId,          // 본인 기록으로 강제
    activity_date: body.activity_date || undefined,
    activity_type: body.activity_type || '기타',
    content: body.content.trim(),
    next_action: body.next_action?.trim() || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: NOT_LINKED }, { status: 400 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const admin = createAdminClient()
  // 본인 기록만 삭제 — 조건 불일치면 0건 삭제로 끝난다 (타인 기록 보호)
  const { data, error } = await admin
    .from('contact_activities')
    .delete()
    .eq('id', id)
    .eq('employee_id', me.employeeId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: '본인 기록만 삭제할 수 있습니다.' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
