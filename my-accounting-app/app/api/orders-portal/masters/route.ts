import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

// 주문 입력용 마스터 조회
// GET                     → { vendors, employees }  (폼 최초 로드)
// GET ?vendor_id=<id>     → { contacts }            (주문처 선택 시 담당자 목록)
// POST { action: 'create_contact', vendor_id, name, phone?, title? }
//   → 담당자 마스터에 없는 인물을 그 자리에서 등록 (contacts + 현재 배정)
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const vendorId = new URL(req.url).searchParams.get('vendor_id')

  if (vendorId) {
    const { data, error } = await admin
      .from('contact_assignments')
      .select('contact_id, title, is_representative, contacts(id, name, phone)')
      .eq('vendor_id', vendorId)
      .is('ended_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const contacts = (data ?? [])
      .map(a => {
        const c = a.contacts as unknown as { id: string; name: string; phone: string | null } | null
        return c && {
          contact_id: c.id, name: c.name, phone: c.phone,
          title: a.title as string | null,
          is_representative: !!a.is_representative,
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b!.is_representative) - Number(a!.is_representative))
    return NextResponse.json({ contacts })
  }

  // 505 미적용 폴백: group_id 없이 재시도
  let vendorsResult = await fetchAllRows<{ id: string; name: string; type: string | null; group_id?: string | null }>(
    (from, to) => admin.from('vendors').select('id, name, type, group_id')
      .eq('is_active', true).order('name').range(from, to),
  )
  if ('error' in vendorsResult) {
    vendorsResult = await fetchAllRows<{ id: string; name: string; type: string | null }>(
      (from, to) => admin.from('vendors').select('id, name, type')
        .eq('is_active', true).order('name').range(from, to),
    )
  }
  const [groupsResult, employeesResult] = await Promise.all([
    admin.from('vendor_groups').select('id, name').eq('is_active', true).order('name'),
    admin.from('employees').select('id, name, position, team')
      .eq('is_active', true).order('name'),
  ])
  if ('error' in vendorsResult) return NextResponse.json({ error: vendorsResult.error }, { status: 500 })
  if (employeesResult.error) return NextResponse.json({ error: employeesResult.error.message }, { status: 500 })

  return NextResponse.json({
    vendors: vendorsResult.data,
    groups: groupsResult.error ? [] : (groupsResult.data ?? []),   // 505 미적용 시 빈 배열
    employees: employeesResult.data ?? [],
    me: { employee_id: me.employeeId, name: me.employeeName, role: me.role },
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | undefined>

  if (body.action === 'create_contact') {
    const vendorId = body.vendor_id
    const name = (body.name ?? '').trim()
    if (!vendorId || !name) return NextResponse.json({ error: '거래처와 이름이 필요합니다.' }, { status: 400 })
    const phone = (body.phone ?? '').trim() || null
    const title = (body.title ?? '').trim() || null

    const { data: contact, error: cErr } = await admin
      .from('contacts').insert({ name, phone }).select('id').single()
    if (cErr) return NextResponse.json({ error: `담당자 등록 실패: ${cErr.message}` }, { status: 500 })

    const { error: aErr } = await admin.from('contact_assignments').insert({
      contact_id: contact.id, vendor_id: vendorId, title, started_at: new Date().toISOString().slice(0, 10),
    })
    if (aErr) return NextResponse.json({ error: `담당자 배정 실패: ${aErr.message}` }, { status: 500 })
    return NextResponse.json({ contact_id: contact.id })
  }

  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
