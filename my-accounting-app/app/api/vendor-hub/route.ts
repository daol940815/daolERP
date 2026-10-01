import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildHubList } from '@/lib/vendor-hub'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/vendor-hub?from=YYYY-MM-DD&to=YYYY-MM-DD[&mine=1]
// 매출처 허브 목록 — 기간 매출·수금·미수·담당·상태. mine=1이면 로그인 직원이 현재
// 담당(vendor_staff, ended_at IS NULL)인 거래처만 — "내 고객".
// can_edit = 고객·영업 그룹 수정 권한 (등록·수정·삭제 버튼 노출용 — 실제 차단은 미들웨어).
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const me = await getCurrentUser()
  const canEdit = !!me && can(me, 'customers', 'edit')
  if (sp.get('mine') === '1') {
    if (!me?.employeeId) return NextResponse.json({ ...result, rows: [], mine: true, mineLinked: false, can_edit: canEdit })
    const { data: vs } = await admin.from('vendor_staff').select('vendor_id')
      .eq('employee_id', me.employeeId).is('ended_at', null)
    const mineIds = new Set((vs ?? []).map(v => v.vendor_id as string))
    return NextResponse.json({ ...result, rows: result.rows.filter(r => mineIds.has(r.vendor_id)), mine: true, mineLinked: true, can_edit: canEdit })
  }
  return NextResponse.json({ ...result, can_edit: canEdit })
}

// POST /api/vendor-hub — 신규 매출처 등록 (미들웨어: customers 수정 권한 + 아르바이트 등록 차단)
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { name?: string; biz_number?: string; note?: string }
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: '매출처명을 입력하세요.' }, { status: 400 })

  // 중복 검사: 활성 거래처의 이름·별칭과 대조 (공백 무시)
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const { data: dups, error: de } = await admin.from('vendors')
    .select('id, name, match_aliases, status')
    .neq('status', 'merged')
  if (de) return NextResponse.json({ error: de.message }, { status: 500 })
  const hit = (dups ?? []).find(v =>
    norm(v.name as string) === norm(name)
    || ((v.match_aliases as string[] | null) ?? []).some(a => norm(a) === norm(name)))
  if (hit) {
    return NextResponse.json({ error: `같은 이름의 거래처가 이미 있습니다: ${hit.name}`, vendor_id: hit.id }, { status: 409 })
  }

  const { data, error } = await admin.from('vendors')
    .insert({
      name,
      biz_number: body.biz_number?.trim() || null,
      note: body.note?.trim() || null,
      type: 'customer',
    })
    .select('id, name')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
