import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildHubList } from '@/lib/vendor-hub'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/vendor-hub?from=YYYY-MM-DD&to=YYYY-MM-DD[&mine=1]
// 매출처 허브 목록 — 기간 매출·수금·미수·담당·상태. mine=1이면 로그인 직원이 현재
// 담당(vendor_staff, ended_at IS NULL)인 거래처만 — "내 고객".
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  if (sp.get('mine') === '1') {
    const me = await getCurrentUser()
    if (!me?.employeeId) return NextResponse.json({ ...result, rows: [], mine: true, mineLinked: false })
    const { data: vs } = await admin.from('vendor_staff').select('vendor_id')
      .eq('employee_id', me.employeeId).is('ended_at', null)
    const mineIds = new Set((vs ?? []).map(v => v.vendor_id as string))
    return NextResponse.json({ ...result, rows: result.rows.filter(r => mineIds.has(r.vendor_id)), mine: true, mineLinked: true })
  }
  return NextResponse.json(result)
}
