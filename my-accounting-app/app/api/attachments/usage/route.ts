import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { STORAGE_FREE_BYTES } from '@/lib/attachments'
import { MIGRATION_HINT_1200, isMissing1200 } from '@/lib/attachments-server'

export const dynamic = 'force-dynamic'

// 파일 저장 공간 사용량 (1200) — 마스터 계정만. Storage 전체 버킷별(발주서 첨부 · 배송 명단 포함) + 공통 첨부의 화면별 합계.
//  GET → { buckets: [{ bucket_id, files, bytes }], total_bytes, limit_bytes, by_owner: [{ owner_type, files, bytes }] }
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.isMaster) return NextResponse.json({ error: '마스터 계정만 볼 수 있습니다.' }, { status: 403 })
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('storage_usage_by_bucket')
  if (error) {
    if (isMissing1200(error.message)) return NextResponse.json({ hint: MIGRATION_HINT_1200, buckets: [], total_bytes: 0, limit_bytes: STORAGE_FREE_BYTES, by_owner: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const buckets = ((data ?? []) as { bucket_id: string; files: number; bytes: number }[]).map(b => ({ bucket_id: b.bucket_id, files: Number(b.files), bytes: Number(b.bytes) }))
  // 공통 첨부의 화면별 합계 — 행 수가 많지 않아 페이지로 모아 더한다 (max-rows 1000 대비)
  const byOwner = new Map<string, { files: number; bytes: number }>()
  for (let from = 0; ; from += 1000) {
    const { data: rows, error: aErr } = await admin.from('attachments').select('owner_type, size_bytes').is('deleted_at', null).range(from, from + 999)
    if (aErr || !rows?.length) break
    for (const r of rows) { const e = byOwner.get(r.owner_type) ?? { files: 0, bytes: 0 }; e.files++; e.bytes += Number(r.size_bytes); byOwner.set(r.owner_type, e) }
    if (rows.length < 1000) break
  }
  return NextResponse.json({
    buckets, total_bytes: buckets.reduce((s, b) => s + b.bytes, 0), limit_bytes: STORAGE_FREE_BYTES,
    by_owner: Array.from(byOwner.entries()).map(([owner_type, v]) => ({ owner_type, ...v })).sort((a, b) => b.bytes - a.bytes),
  })
}
