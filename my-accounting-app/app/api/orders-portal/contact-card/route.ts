import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { parseManagerName } from '@/lib/contact-resolve'

export const dynamic = 'force-dynamic'

// GET /api/orders-portal/contact-card?contact_id=&order_id=
// 주문 상세의 담당자(거래처) 정보 카드 (2026-11-13 사용자 승인, 시안 docs/mockups/주문상세_담당자연결_시안.html)
//  - 주문에 적힌 표기는 원본 그대로 두고, 그 사람의 "지금" 정보를 보여 준다.
//  - 같은 사람 = 고객코드. 병합된 인물이면 남는 인물로 따라간다.
//  - 이 주문 당시 직함(주문 표기에서) · 현재 직함(배정) · 최근 직함 변경일(117 이력, 미적용이면 없음)
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  let contactId = sp.get('contact_id') ?? ''
  const orderId = sp.get('order_id')
  if (!contactId) return NextResponse.json({ error: 'contact_id가 필요합니다.' }, { status: 400 })

  // 병합된 인물이면 남는 인물로
  for (let i = 0; i < 5; i++) {
    const { data } = await admin.from('contacts').select('merged_into_id').eq('id', contactId).maybeSingle()
    if (!data?.merged_into_id) break
    contactId = data.merged_into_id as string
  }
  const { data: c, error } = await admin.from('contacts').select('id, name, code, phone').eq('id', contactId).maybeSingle()
  if (error || !c) return NextResponse.json({ error: error?.message ?? '담당자를 찾을 수 없습니다.' }, { status: 404 })
  // 유선 (116) — 미적용이면 없음
  const { data: telRow } = await admin.from('contacts').select('tel').eq('id', contactId).maybeSingle()

  const { data: absorbed } = await admin.from('contacts').select('id').eq('merged_into_id', contactId)
  const selfIds = [contactId, ...((absorbed ?? []).map(a => a.id as string))]

  const [asgRes, ordRes, orderRes, chgRes] = await Promise.all([
    admin.from('contact_assignments').select('id, vendor_id, title, staff_employee_id, vendors(name)')
      .eq('contact_id', contactId).is('ended_at', null),
    admin.from('erp_orders').select('id, order_date, canceled_at').in('contact_id', selfIds),
    orderId ? admin.from('erp_orders').select('manager_name, vendor_id').eq('id', orderId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('contact_assignment_changes').select('assignment_id, changed_at').eq('contact_id', contactId).eq('field', 'title')
      .order('changed_at', { ascending: false }).limit(50),
  ])
  const lastTitleChange = new Map<string, string>()
  if (!chgRes.error) for (const ch of chgRes.data ?? []) {
    if (!lastTitleChange.has(ch.assignment_id as string)) lastTitleChange.set(ch.assignment_id as string, (ch.changed_at as string).slice(0, 10))
  }
  const staffIds = Array.from(new Set((asgRes.data ?? []).map(a => a.staff_employee_id as string | null).filter((v): v is string => !!v)))
  const staffName = new Map<string, string>()
  if (staffIds.length) {
    const { data } = await admin.from('employees').select('id, name').in('id', staffIds)
    for (const e of data ?? []) staffName.set(e.id as string, e.name as string)
  }
  const current = (asgRes.data ?? []).map(a => ({
    vendor_id: a.vendor_id as string,
    vendor_name: (a.vendors as unknown as { name: string } | null)?.name ?? '',
    title: (a.title as string | null) ?? null,
    staff_name: a.staff_employee_id ? staffName.get(a.staff_employee_id as string) ?? null : null,
    title_changed_at: lastTitleChange.get(a.id as string) ?? null,
  }))
  // 이 주문의 주문처를 맨 앞으로
  const orderVendor = (orderRes.data as { vendor_id?: string | null } | null)?.vendor_id ?? null
  current.sort((a, b) => Number(b.vendor_id === orderVendor) - Number(a.vendor_id === orderVendor))

  const orders = (ordRes.data ?? []).filter(o => !o.canceled_at)
  const lastOrder = orders.map(o => o.order_date as string).sort().pop() ?? null
  const atOrder = parseManagerName((orderRes.data as { manager_name?: string | null } | null)?.manager_name ?? null)

  return NextResponse.json({
    contact_id: contactId,
    name: c.name as string,
    code: (c.code as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    tel: ((telRow as { tel?: string | null } | null)?.tel) ?? null,
    title_at_order: atOrder?.title ?? null,
    current,
    order_count: orders.length,
    last_order_date: lastOrder,
  })
}
