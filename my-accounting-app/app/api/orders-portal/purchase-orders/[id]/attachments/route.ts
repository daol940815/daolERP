import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 발주서 첨부 파일 (510) — Storage 버킷 'po-attachments' (비공개, 서비스 키 경유).
//  kind 'replace' = 발주서 수정본 (발송 시 자동 생성본 대신 첨부)
//  kind 'extra'   = 추가 자료 (자동 생성본과 함께 첨부)
// GET → { attachments } / GET ?download=<id> → 파일 스트림
// POST (FormData: file, kind) / DELETE ?aid=<id>

const BUCKET = 'po-attachments'
const MAX_BYTES = 10 * 1024 * 1024   // 10MB — 메일 첨부 한도 고려
const HINT = '510 마이그레이션(발주서 발송 페이지)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missing = (msg: string) => /erp_po_attachments|relation|does not exist|bucket/i.test(msg)

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const download = new URL(req.url).searchParams.get('download')

  if (download) {
    const { data: att, error } = await admin.from('erp_po_attachments')
      .select('file_name, storage_path').eq('id', download).eq('po_id', params.id).maybeSingle()
    if (error || !att) return NextResponse.json({ error: '첨부를 찾을 수 없습니다.' }, { status: 404 })
    const { data: blob, error: dErr } = await admin.storage.from(BUCKET).download(att.storage_path)
    if (dErr || !blob) return NextResponse.json({ error: `다운로드 실패: ${dErr?.message ?? '파일 없음'}` }, { status: 500 })
    const buf = Buffer.from(await blob.arrayBuffer())
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.file_name)}`,
      },
    })
  }

  const { data, error } = await admin.from('erp_po_attachments')
    .select('id, kind, file_name, size_bytes, created_at, uploader:employees!erp_po_attachments_uploaded_by_fkey(name)')
    .eq('po_id', params.id).order('created_at')
  if (error) {
    // 510 미적용 — 첨부 기능만 비활성 (발송 페이지 자체는 동작)
    if (missing(error.message)) return NextResponse.json({ attachments: [], hint: HINT })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    attachments: (data ?? []).map(a => ({
      ...a,
      uploader_name: (a.uploader as unknown as { name: string } | null)?.name ?? null,
      uploader: undefined,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const { data: po } = await admin.from('erp_purchase_orders')
    .select('id, status').eq('id', params.id).maybeSingle()
  if (!po) return NextResponse.json({ error: '발주서를 찾을 수 없습니다.' }, { status: 404 })
  if (po.status !== 'active') return NextResponse.json({ error: '취소된 발주서에는 첨부할 수 없습니다.' }, { status: 400 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file') as File | null
  const kind = String(formData?.get('kind') ?? 'replace')
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (!['replace', 'extra'].includes(kind)) return NextResponse.json({ error: '첨부 구분이 올바르지 않습니다.' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '파일이 10MB를 넘습니다. 메일 첨부 한도를 고려해 줄여주세요.' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  // 경로: <po_id>/<타임스탬프>_<파일명> — 같은 이름 재업로드 충돌 방지
  const safeName = file.name.replace(/[/\\]/g, '_')
  const path = `${params.id}/${Date.now()}_${safeName}`
  const { error: upErr } = await admin.storage.from(BUCKET)
    .upload(path, buf, { contentType: file.type || 'application/octet-stream' })
  if (upErr) {
    return NextResponse.json({ error: missing(upErr.message) ? HINT : `업로드 실패: ${upErr.message}` }, { status: 500 })
  }

  const { data: created, error } = await admin.from('erp_po_attachments').insert({
    po_id: params.id, kind, file_name: safeName, storage_path: path,
    size_bytes: file.size, uploaded_by: me.employeeId ?? null,
  }).select('id').single()
  if (error) {
    await admin.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: missing(error.message) ? HINT : error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: created.id })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const aid = new URL(req.url).searchParams.get('aid')
  if (!aid) return NextResponse.json({ error: 'aid가 필요합니다.' }, { status: 400 })

  const { data: att } = await admin.from('erp_po_attachments')
    .select('id, storage_path').eq('id', aid).eq('po_id', params.id).maybeSingle()
  if (!att) return NextResponse.json({ error: '첨부를 찾을 수 없습니다.' }, { status: 404 })

  await admin.storage.from(BUCKET).remove([att.storage_path])
  const { error } = await admin.from('erp_po_attachments').delete().eq('id', aid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
