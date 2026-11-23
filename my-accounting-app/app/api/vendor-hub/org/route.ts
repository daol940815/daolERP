import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import {
  createChildVendor, loadOrgDetail, locationCandidates, parentCandidates, setVendorOrg, suggestRenameForParent,
} from '@/lib/vendor-org'

export const dynamic = 'force-dynamic'

// 매출처 하위 조직 · 위치 (120, 2026-11-20 — 시안 docs/mockups/매출처_하위조직_시안.html). 권한: 거래처 관리(customers)
// GET ?vendor_id=&from=&to=                    → 경로 · 상위 · 위치 · 하위 조직 트리(숫자 포함) · 변경 이력
// GET ?candidates=parent&vendor_id=&q=          → 상위 조직 후보(같은 업체, 자기 · 하위 제외)
// GET ?candidates=child&vendor_id=&q=           → 하위로 편입할 후보(같은 업체, 자기 · 상위 제외 — 상위 후보와 같은 규칙을 반대로)
// GET ?candidates=location&vendor_id=&q=        → 위치 후보(활성 매출처)
// GET ?rename_for=<자식 id>&parent_id=           → 상위를 바꿀 때 제안하는 이름(규칙: 업체명 + 상위 단위 + 팀명)
// POST { action: 'set', vendor_id, parent_id?, location_id?, rename? }   — 상위 · 위치 지정(편입 · 빼기 포함)
// POST { action: 'create_child', parent_id, unit, location_id? }        — 새 하위 조직 등록
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendor_id')
  const cand = sp.get('candidates')
  if (cand) {
    let groupId: string | null = null
    if (vendorId) {
      const { data } = await admin.from('vendors').select('group_id').eq('id', vendorId).maybeSingle()
      groupId = (data?.group_id as string | null) ?? null
    }
    const q = sp.get('q') ?? ''
    if (cand === 'location') return NextResponse.json({ items: await locationCandidates(admin, groupId, q, vendorId) })
    if (cand === 'parent') return NextResponse.json({ items: await parentCandidates(admin, vendorId, groupId, q) })
    if (cand === 'child') {
      // 편입 후보: 같은 업체의 매출처 중 이 조직(vendorId)을 상위로 둘 수 있는 것 = 이 조직의 상위가 아닌 것
      const all = await parentCandidates(admin, null, groupId, q)
      const det = vendorId ? await loadOrgDetail(admin, vendorId, null, null) : null
      const banned = new Set(det && !('error' in det) ? [vendorId!, ...det.path.map(p => p.id), ...det.rows.map(r => r.id)] : [vendorId])
      return NextResponse.json({ items: all.filter(x => !banned.has(x.id)) })
    }
    return NextResponse.json({ error: '알 수 없는 후보 종류입니다.' }, { status: 400 })
  }
  const renameFor = sp.get('rename_for')
  if (renameFor) return NextResponse.json({ name: await suggestRenameForParent(admin, renameFor, sp.get('parent_id') || null) })
  if (!vendorId) return NextResponse.json({ error: 'vendor_id가 필요합니다.' }, { status: 400 })
  const r = await loadOrgDetail(admin, vendorId, sp.get('from'), sp.get('to'))
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 404 })
  const me = await getCurrentUser()
  return NextResponse.json({ ...r, can_edit: !!me && can(me, 'customers', 'edit') })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'customers', 'edit')) return NextResponse.json({ error: '하위 조직 지정은 거래처 관리 수정 권한이 필요합니다.' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as {
    action?: string; vendor_id?: string; parent_id?: string | null; location_id?: string | null; rename?: string | null; unit?: string
  }
  const admin = createAdminClient()
  const actor = { id: me.employeeId ?? null, name: me.employeeName ?? null }
  if (body.action === 'set') {
    if (!body.vendor_id) return NextResponse.json({ error: 'vendor_id가 필요합니다.' }, { status: 400 })
    const r = await setVendorOrg(admin, body.vendor_id, {
      ...('parent_id' in body ? { parent_id: body.parent_id || null } : {}),
      ...('location_id' in body ? { location_id: body.location_id || null } : {}),
      rename: body.rename ?? null,
    }, actor)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json(r)
  }
  if (body.action === 'create_child') {
    const r = await createChildVendor(admin, body.parent_id ?? '', body.unit ?? '', body.location_id || null, actor)
    if ('error' in r) return NextResponse.json(r, { status: r.existing ? 409 : 400 })
    return NextResponse.json(r)
  }
  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
