import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { linkBranchToVendor, listBankBranches, registerBranch, searchUnlinkedBranches, vendorBranchInfo } from '@/lib/bank-branches'

export const dynamic = 'force-dynamic'

// 은행 점포 목록 (121, 2026-11-23 — 시안 docs/mockups/은행점포_목록_시안.html). 권한: 거래처 관리(customers)
// GET ?group=&sido=&sigungu=&q=&status=all|unlinked|linked|missing&offset=&limit=  → KPI · 은행별 · 시도 · 목록
// GET ?search=&group=                           → 등록 창 지점명 아래 미등록 점포(최대 6)
// GET ?vendor_id=                                → 매출처 상세용 점포 정보(연결 점포 또는 비슷한 미연결 점포)
// POST { action: 'register', branch_id }         → 점포를 매출처로 등록(같은 지점 매출처가 있으면 그걸 연결)
// POST { action: 'link', branch_id, vendor_id }  → 점포 ↔ 매출처 연결 / { action: 'unlink', branch_id }
// POST { action: 'not_branch', vendor_id, value } → 은행 매출처를 '점포 아님'으로(점포 목록 대조에서 제외)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendor_id')
  const me = await getCurrentUser()
  const canEdit = !!me && can(me, 'customers', 'edit')
  if (vendorId) return NextResponse.json({ ...(await vendorBranchInfo(admin, vendorId)), can_edit: canEdit })
  if (sp.has('search')) return NextResponse.json({ items: await searchUnlinkedBranches(admin, sp.get('search') ?? '', sp.get('group') || null, 6) })
  const st = sp.get('status')
  const r = await listBankBranches(admin, {
    group: sp.get('group') || null, sido: sp.get('sido') || null, sigungu: sp.get('sigungu') || null, q: sp.get('q') || null,
    status: st === 'unlinked' || st === 'linked' || st === 'missing' ? st : 'all',
    offset: Number(sp.get('offset') ?? 0) || 0, limit: Math.min(Number(sp.get('limit') ?? 100) || 100, 500),
  })
  return NextResponse.json({ ...r, can_edit: canEdit })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'customers', 'edit')) return NextResponse.json({ error: '점포 등록 · 연결은 거래처 관리 수정 권한이 필요합니다(담당: 영업지원팀).' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { action?: string; branch_id?: string; vendor_id?: string; value?: boolean }
  const admin = createAdminClient()
  const actor = me.employeeName ?? '직원'
  if (body.action === 'register') {
    if (!body.branch_id) return NextResponse.json({ error: 'branch_id가 필요합니다.' }, { status: 400 })
    const r = await registerBranch(admin, body.branch_id, actor)
    return 'error' in r ? NextResponse.json(r, { status: 400 }) : NextResponse.json(r)
  }
  if (body.action === 'link' || body.action === 'unlink') {
    if (!body.branch_id) return NextResponse.json({ error: 'branch_id가 필요합니다.' }, { status: 400 })
    const r = await linkBranchToVendor(admin, body.branch_id, body.action === 'link' ? body.vendor_id ?? null : null, actor)
    return 'error' in r ? NextResponse.json(r, { status: 400 }) : NextResponse.json(r)
  }
  if (body.action === 'not_branch') {
    if (!body.vendor_id) return NextResponse.json({ error: 'vendor_id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('vendors').update({ not_bank_branch: !!body.value }).eq('id', body.vendor_id)
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
