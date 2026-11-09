import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import {
  ROSTER_BUCKET, ROSTER_MAX_BYTES, ROSTER_MIGRATION_HINT, isRosterMissing,
  parseRosterWorkbook, rosterSummary, type RosterRowInput,
} from '@/lib/delivery-roster'
import { rosterCandidates, findRoster } from '@/lib/delivery-roster-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 개별 배송 명단 (707)
// GET  ?consultation_id=… | ?order_id=…  → { roster, rows, summary, candidates }
// POST FormData(file, consultation_id | order_id) → 표준 양식 파싱 → 기존 명단 교체 → 원본 파일 보관
// 권한: 조회 = 주문 그룹 조회(미들웨어), 업로드 = 수정(미들웨어). 아르바이트 신규 거래처 차단과 무관.

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams
  const consultationId = sp.get('consultation_id')
  const orderId = sp.get('order_id')
  if (!consultationId && !orderId) return NextResponse.json({ error: 'consultation_id 또는 order_id가 필요합니다.' }, { status: 400 })

  const { roster, error } = await findRoster(admin, { consultationId, orderId })
  if (error) {
    if (isRosterMissing(error.message)) return NextResponse.json({ roster: null, rows: [], summary: null, candidates: [], hint: ROSTER_MIGRATION_HINT })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const candidates = await rosterCandidates(admin, { consultationId, orderId })
  if (!roster) return NextResponse.json({ roster: null, rows: [], summary: null, candidates })

  let q = admin.from('erp_delivery_roster_rows').select('*').eq('roster_id', roster.id).order('seq')
  // 주문 기준 조회는 그 주문에 연결된 행만 (분할 전환 대응). 아직 연결 전(order_id 없음)인 행은 상담에서만 보인다.
  if (orderId && !consultationId) q = q.eq('order_id', orderId)
  const { data: rows, error: rErr } = await q.limit(5000)
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })

  const { data: uploader } = roster.uploaded_by
    ? await admin.from('employees').select('name').eq('id', roster.uploaded_by).maybeSingle()
    : { data: null }
  const typed = (rows ?? []) as unknown as RosterRowInput[]
  return NextResponse.json({
    roster: { ...roster, uploader_name: uploader?.name ?? null },
    rows: typed,
    summary: rosterSummary(typed, candidates),
    candidates,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const fd = await req.formData().catch(() => null)
  const file = fd?.get('file') as File | null
  const consultationId = String(fd?.get('consultation_id') ?? '') || null
  const orderId = String(fd?.get('order_id') ?? '') || null
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (!consultationId && !orderId) return NextResponse.json({ error: '상담 또는 주문을 먼저 저장한 뒤 명단을 올려주세요.' }, { status: 400 })
  if (file.size > ROSTER_MAX_BYTES) return NextResponse.json({ error: '파일이 5MB를 넘습니다.' }, { status: 400 })

  const candidates = await rosterCandidates(admin, { consultationId, orderId })
  const buf = Buffer.from(await file.arrayBuffer())
  const parsed = parseRosterWorkbook(buf, candidates)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 기존 명단 교체 (사용자 확정: 누적 아님)
  const existing = await findRoster(admin, { consultationId, orderId })
  if (existing.error) {
    return NextResponse.json({ error: isRosterMissing(existing.error.message) ? ROSTER_MIGRATION_HINT : existing.error.message }, { status: 500 })
  }
  if (existing.roster) {
    if (existing.roster.storage_path) await admin.storage.from(ROSTER_BUCKET).remove([existing.roster.storage_path as string])
    await admin.from('erp_delivery_rosters').delete().eq('id', existing.roster.id)
  }

  // 원본 파일 보관 — Storage 키는 ASCII만 (한글 파일명은 DB에 보존)
  const safeName = file.name.replace(/[/\\]/g, '_')
  const ext = (safeName.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '.xlsx').toLowerCase()
  const owner = consultationId ?? orderId!
  const path = `${owner}/${Date.now()}_roster${ext}`
  const { error: upErr } = await admin.storage.from(ROSTER_BUCKET)
    .upload(path, buf, { contentType: file.type || 'application/octet-stream' })
  if (upErr) {
    return NextResponse.json({ error: isRosterMissing(upErr.message) ? ROSTER_MIGRATION_HINT : `원본 보관 실패: ${upErr.message}` }, { status: 500 })
  }

  // 주문에서 직접 올린 명단은 행에도 order_id — 발주서가 바로 쓴다. 상담 명단은 전환 때 연결.
  const { data: roster, error } = await admin.from('erp_delivery_rosters').insert({
    consultation_id: consultationId, order_id: consultationId ? null : orderId,
    file_name: safeName, storage_path: path, uploaded_by: me.employeeId,
  }).select('*').single()
  if (error) {
    await admin.storage.from(ROSTER_BUCKET).remove([path])
    return NextResponse.json({ error: isRosterMissing(error.message) ? ROSTER_MIGRATION_HINT : error.message }, { status: 500 })
  }
  const { error: rErr } = await admin.from('erp_delivery_roster_rows').insert(
    parsed.rows.map(r => ({ ...r, id: undefined, roster_id: roster.id, order_id: consultationId ? null : orderId })),
  )
  if (rErr) {
    await admin.from('erp_delivery_rosters').delete().eq('id', roster.id)
    await admin.storage.from(ROSTER_BUCKET).remove([path])
    return NextResponse.json({ error: `명단 저장 실패: ${rErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true, roster_id: roster.id, row_count: parsed.rows.length, skipped: parsed.skipped,
    summary: rosterSummary(parsed.rows, candidates),
  })
}
