import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildHubDetail } from '@/lib/vendor-hub'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/vendor-hub/[vendorId]?from=&to=  — 거래처 360° 상세 번들
export async function GET(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildHubDetail(admin, params.vendorId, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}

// PATCH — 활동 메모(vendors.note) 저장
export async function PATCH(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { note?: string | null }
  if (!('note' in body)) return NextResponse.json({ error: 'note가 필요합니다.' }, { status: 400 })
  const { error } = await admin.from('vendors')
    .update({ note: body.note?.trim() || null })
    .eq('id', params.vendorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
