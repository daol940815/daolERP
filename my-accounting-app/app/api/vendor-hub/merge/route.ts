import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { executeVendorMerge, previewVendorMerge, searchMergeTargets } from '@/lib/vendor-merge'

export const dynamic = 'force-dynamic'

// 매출처 합치기 (2026-11-16, 시안 docs/mockups/매출처_합치기_시안.html) — 권한: 거래처 관리(customers)
// GET ?q=&exclude=        → 합칠 대상 검색
// GET ?from=&into=        → 미리보기(건수 · 경고 · 막는 이유 · 같은 이름 담당자)
// POST { from_id, into_id } → 전체 병합 실행 (from이 into로 흡수)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const q = sp.get('q')
  if (q !== null) return NextResponse.json({ vendors: await searchMergeTargets(admin, q, sp.get('exclude') ?? '') })
  const r = await previewVendorMerge(admin, sp.get('from') ?? '', sp.get('into') ?? '')
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(me, 'customers', 'edit')) {
    return NextResponse.json({ error: '매출처 합치기는 거래처 관리 수정 권한이 필요합니다.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { from_id?: string; into_id?: string }
  const admin = createAdminClient()
  const r = await executeVendorMerge(admin, body.from_id ?? '', body.into_id ?? '', `${me.employeeName ?? me.email ?? ''}(매출처 합치기)`)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
