import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/crm/contacts/:id
// 고객 상세: 기본 정보 + 매출 버킷(명절·월별, 엑셀 이관분 포함) + 주문 목록
// + 관리 활동 + 등급 스냅샷 + 매칭 키
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params

  const { data: contact, error: ce } = await admin
    .from('crm_contacts')
    .select('*')
    .eq('id', id)
    .single()
  if (ce) return NextResponse.json({ error: ce.message }, { status: 404 })

  // 매출 라인 (erp 기간: 2025~) — 뷰에서 버킷으로 집계
  const lines = await fetchAllRows((from, to) =>
    admin
      .from('crm_sales_lines')
      .select('order_date, season_code, amount')
      .eq('contact_id', id)
      .range(from, to))
  if ('error' in lines) return NextResponse.json({ error: lines.error }, { status: 500 })

  const buckets = new Map<string, { season_code: string | null; month: string | null; amount: number; legacy: boolean }>()
  for (const l of lines.data as { order_date: string; season_code: string | null; amount: number }[]) {
    const key = l.season_code ?? l.order_date.slice(0, 7)
    const b = buckets.get(key) ?? {
      season_code: l.season_code, month: l.season_code ? null : l.order_date.slice(0, 7),
      amount: 0, legacy: false,
    }
    b.amount += l.amount
    buckets.set(key, b)
  }
  // 엑셀 이관분 (2024) — 같은 버킷이 있으면 합산하지 않고 별도 행 (출처 구분 표시)
  const { data: legacyRows, error: le } = await admin
    .from('crm_legacy_sales')
    .select('season_code, sales_month, amount')
    .eq('contact_id', id)
  if (le) return NextResponse.json({ error: le.message }, { status: 500 })
  for (const g of legacyRows ?? []) {
    const key = 'L|' + (g.season_code ?? g.sales_month)
    buckets.set(key, {
      season_code: g.season_code, month: g.sales_month, amount: g.amount, legacy: true,
    })
  }

  const [orders, activities, snapshots, keys] = await Promise.all([
    admin
      .from('erp_orders')
      .select('id, order_no, order_date, season_code, total_amount, collect_status')
      .eq('crm_contact_id', id)
      .order('order_date', { ascending: false })
      .limit(200),
    admin
      .from('crm_activities')
      .select('*')
      .eq('contact_id', id)
      .order('activity_date', { ascending: false })
      .limit(100),
    admin
      .from('crm_grade_snapshots')
      .select('eval_month, revenue_grade, continuity_grade, intimacy_grade, overall_grade, total_revenue')
      .eq('contact_id', id)
      .order('eval_month', { ascending: false })
      .limit(24),
    admin
      .from('crm_contact_keys')
      .select('id, bank_name, branch_name, manager_name, source')
      .eq('contact_id', id),
  ])
  for (const r of [orders, activities, snapshots, keys]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  }

  return NextResponse.json({
    contact,
    buckets: Array.from(buckets.values()),
    orders: orders.data,
    activities: activities.data,
    snapshots: snapshots.data,
    keys: keys.data,
  })
}

// PATCH /api/crm/contacts/:id — 편집 가능한 필드만 갱신
const EDITABLE = new Set([
  'bank_name', 'branch_name', 'name', 'title', 'role', 'phone', 'office_phone',
  'intimacy_grade', 'keyman', 'is_rotc', 'counselor_now', 'status', 'memo', 'vendor_id',
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = createAdminClient()
  const { id } = await params
  const body = await req.json()
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) patch[k] = v === '' ? null : v
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 })
  }
  if ('intimacy_grade' in patch && patch.intimacy_grade !== null
      && !['A', 'B', 'C', 'D'].includes(patch.intimacy_grade as string)) {
    return NextResponse.json({ error: '친밀도 등급은 A~D 또는 빈 값이어야 합니다.' }, { status: 400 })
  }
  const { data, error } = await admin
    .from('crm_contacts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
