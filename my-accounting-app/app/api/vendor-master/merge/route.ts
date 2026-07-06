import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// POST /api/vendor-master/merge
// body: { kind: 'erp_alias' | 'vendor', from_id: string, into_id: string }
// 정책(§6): 자동 병합 금지 — 이 API는 사용자가 화면에서 승인했을 때만 호출된다.
// 이력(vendor_merge_logs)은 RPC가 기록하며, 수행자(actor)는 로그인 이메일을 남긴다.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const body = await req.json().catch(() => null) as
    { kind?: string; from_id?: string; into_id?: string } | null
  if (!body?.kind || !body.from_id || !body.into_id) {
    return NextResponse.json({ error: 'kind, from_id, into_id가 필요합니다.' }, { status: 400 })
  }
  if (body.from_id === body.into_id) {
    return NextResponse.json({ error: '같은 대상을 병합할 수 없습니다.' }, { status: 400 })
  }
  const fn = body.kind === 'vendor' ? 'merge_vendor'
    : body.kind === 'erp_alias' ? 'merge_erp_alias'
    : null
  if (!fn) return NextResponse.json({ error: 'kind는 vendor 또는 erp_alias여야 합니다.' }, { status: 400 })

  const { data, error } = await admin.rpc(fn, {
    p_from: body.from_id,
    p_into: body.into_id,
    p_actor: user?.email ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, moved: data })
}
