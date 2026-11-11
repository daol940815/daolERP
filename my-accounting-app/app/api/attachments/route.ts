import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { ATTACH_BUCKET, ATTACH_MAX_BYTES, ATTACH_MAX_PER_OWNER, extOf, isAllowedFile, isImageName, fmtBytes, type AttachmentItem } from '@/lib/attachments'
import { ATTACHMENT_OWNERS, MIGRATION_HINT_1200, isMissing1200 } from '@/lib/attachments-server'

export const dynamic = 'force-dynamic'

// 공통 첨부 파일 (1200, 2026-11-11) — 파일 본체는 오가지 않는다(브라우저 ↔ Storage 직접). 이 API 는 판정 · 서명 · 기록만.
//  GET    ?owner_type=&owner_id=   또는 ?owner_type=&draft_key=   — 목록 + can_add (사진은 미리보기 서명 URL 포함)
//  GET    ?download=<id>                                           — { url } 5분짜리 내려받기 서명 URL
//  POST   { action:'sign', owner_type, owner_id?|draft_key?, file_name, size }       — 올려도 되는지 확인 → { path, token }
//  POST   { action:'confirm', owner_type, owner_id?|draft_key?, path, file_name, mime?, width?, height? } — Storage 에 올라간 것 확인 후 기록
//  DELETE ?id=<id>                                                 — 파일 삭제 + 기록에 deleted_at (행은 남긴다)
//  임시 업로드(draft_key): 저장 전 작성 화면. 본인이 올린 것만 보이고, 저장 API 가 linkDraftAttachments 로 연결한다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status })
const fail = (m: string) => err(isMissing1200(m) ? MIGRATION_HINT_1200 : m, 500)

type Target = { ownerType: string; ownerId: string | null; draftKey: string | null }
function readTarget(src: { owner_type?: unknown; owner_id?: unknown; draft_key?: unknown }): Target | string {
  const ownerType = String(src.owner_type ?? '')
  if (!ATTACHMENT_OWNERS[ownerType]) return '첨부를 쓸 수 없는 화면입니다.'
  const ownerId = src.owner_id ? String(src.owner_id) : null
  const draftKey = src.draft_key ? String(src.draft_key) : null
  if (ownerId && !UUID.test(ownerId)) return '대상이 올바르지 않습니다.'
  if (draftKey && !UUID.test(draftKey)) return '임시 키가 올바르지 않습니다.'
  if (!ownerId && !draftKey) return '대상이 없습니다.'
  return { ownerType, ownerId, draftKey: ownerId ? null : draftKey }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return err('로그인이 필요합니다.', 401)
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams

  const download = sp.get('download')
  if (download) {
    if (!UUID.test(download)) return err('대상이 올바르지 않습니다.')
    const { data: att, error } = await admin.from('attachments')
      .select('id, owner_type, owner_id, uploaded_by, file_name, storage_path, deleted_at').eq('id', download).maybeSingle()
    if (error) return fail(error.message)
    if (!att || att.deleted_at) return err('파일을 찾을 수 없습니다. 삭제되었을 수 있습니다.', 404)
    const rule = ATTACHMENT_OWNERS[att.owner_type]
    const allowed = att.owner_id ? !!rule && await rule.canView(me, att.owner_id, admin) : att.uploaded_by === me.employeeId
    if (!allowed) return err('이 파일을 볼 권한이 없습니다. 그 업무를 볼 수 있는 사람만 내려받을 수 있습니다.', 403)
    const inline = sp.get('inline') === '1'
    const { data: s, error: sErr } = await admin.storage.from(ATTACH_BUCKET).createSignedUrl(att.storage_path, 300, inline ? undefined : { download: att.file_name })
    if (sErr || !s) return fail(sErr?.message ?? '서명 URL 생성 실패')
    return NextResponse.json({ url: s.signedUrl })
  }

  const t = readTarget({ owner_type: sp.get('owner_type'), owner_id: sp.get('owner_id'), draft_key: sp.get('draft_key') })
  if (typeof t === 'string') return err(t)
  const rule = ATTACHMENT_OWNERS[t.ownerType]
  let canAdd: boolean
  if (t.ownerId) {
    if (!(await rule.canView(me, t.ownerId, admin))) return err('이 건의 첨부를 볼 권한이 없습니다.', 403)
    canAdd = await rule.canAdd(me, t.ownerId, admin)
  } else {
    canAdd = !!me.employeeId
  }
  let q = admin.from('attachments')
    .select('id, owner_type, owner_id, file_name, storage_path, mime, size_bytes, width, height, created_at, uploaded_by, uploader:employees!attachments_uploaded_by_fkey(id, name)')
    .eq('owner_type', t.ownerType).is('deleted_at', null).order('created_at')
  q = t.ownerId ? q.eq('owner_id', t.ownerId) : q.eq('draft_key', t.draftKey!).is('owner_id', null).eq('uploaded_by', me.employeeId ?? '00000000-0000-0000-0000-000000000000')
  const { data, error } = await q
  if (error) {
    if (isMissing1200(error.message)) return NextResponse.json({ items: [], can_add: false, hint: MIGRATION_HINT_1200 })
    return fail(error.message)
  }
  type Raw = { id: string; owner_type: string; owner_id: string | null; file_name: string; storage_path: string; mime: string | null; size_bytes: number; width: number | null; height: number | null; created_at: string; uploaded_by: string | null; uploader: { id: string; name: string } | { id: string; name: string }[] | null }
  const rows = (data ?? []) as unknown as Raw[]
  // 사진 미리보기 — 10분짜리 서명 URL 을 한 번에
  const imgs = rows.filter(r => isImageName(r.file_name))
  const previews = new Map<string, string>()
  if (imgs.length) {
    const { data: urls } = await admin.storage.from(ATTACH_BUCKET).createSignedUrls(imgs.map(r => r.storage_path), 600)
    for (const u of urls ?? []) if (u.path && u.signedUrl) previews.set(u.path, u.signedUrl)
  }
  const items: AttachmentItem[] = await Promise.all(rows.map(async r => ({
    id: r.id, file_name: r.file_name, mime: r.mime, size_bytes: Number(r.size_bytes), width: r.width, height: r.height, created_at: r.created_at,
    uploader: Array.isArray(r.uploader) ? r.uploader[0] ?? null : r.uploader,
    can_delete: t.ownerId ? await rule.canDelete(me, { id: r.id, owner_type: r.owner_type, owner_id: r.owner_id, uploaded_by: r.uploaded_by }, admin) : true,
    preview_url: previews.get(r.storage_path) ?? null,
  })))
  return NextResponse.json({ items, can_add: canAdd && items.length < ATTACH_MAX_PER_OWNER })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return err('로그인이 필요합니다.', 401)
  if (!me.employeeId) return err('직원 정보와 연결되지 않은 계정은 파일을 올릴 수 없습니다.')
  const body = await req.json().catch(() => ({})) as {
    action?: string; owner_type?: string; owner_id?: string; draft_key?: string
    file_name?: string; size?: number; path?: string; mime?: string; width?: number; height?: number
  }
  const t = readTarget(body)
  if (typeof t === 'string') return err(t)
  const admin = createAdminClient()
  const rule = ATTACHMENT_OWNERS[t.ownerType]
  if (t.ownerId && !(await rule.canAdd(me, t.ownerId, admin))) return err('이 건에는 파일을 붙일 수 없습니다. 열린 건의 요청자 · 담당자만 붙일 수 있습니다.', 403)

  const fileName = String(body.file_name ?? '').replace(/[/\\]/g, '_').trim().slice(0, 200)
  if (!fileName) return err('파일 이름이 없습니다.')
  if (!isAllowedFile(fileName)) return err('올릴 수 없는 형식입니다. 사진 · PDF · 엑셀 · 워드 · 한글 · 파워포인트 · zip · txt 만 받습니다.')

  // 한 건당 개수 상한
  let cq = admin.from('attachments').select('id', { count: 'exact', head: true }).eq('owner_type', t.ownerType).is('deleted_at', null)
  cq = t.ownerId ? cq.eq('owner_id', t.ownerId) : cq.eq('draft_key', t.draftKey!).is('owner_id', null)
  const { count, error: cErr } = await cq
  if (cErr) return fail(cErr.message)
  if ((count ?? 0) >= ATTACH_MAX_PER_OWNER) return err(`한 건에 ${ATTACH_MAX_PER_OWNER}개까지 붙일 수 있습니다.`)

  if (body.action === 'sign') {
    const size = Number(body.size ?? 0)
    if (!(size > 0)) return err('빈 파일입니다.')
    if (size > ATTACH_MAX_BYTES) return err(`파일이 ${fmtBytes(ATTACH_MAX_BYTES)}를 넘습니다(${fmtBytes(size)}). 큰 파일은 회사 서버에 두고 관련 링크 칸에 경로를 적어주세요.`)
    // 경로는 ASCII 만 (Storage 키는 한글 불가) — 원본 이름은 기록(file_name)에 둔다. 올린 사람 id 를 넣어 남의 경로로 confirm 하지 못하게 한다.
    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)
    const ext = extOf(fileName)
    const path = `${t.ownerType}/${month}/${me.employeeId}/${randomUUID()}${ext ? `.${ext}` : ''}`
    const { data, error } = await admin.storage.from(ATTACH_BUCKET).createSignedUploadUrl(path)
    if (error || !data) return fail(error?.message ?? '업로드 주소 발급 실패')
    return NextResponse.json({ path: data.path, token: data.token })
  }

  if (body.action === 'confirm') {
    const path = String(body.path ?? '')
    if (!path.startsWith(`${t.ownerType}/`) || !path.includes(`/${me.employeeId}/`)) return err('업로드 경로가 올바르지 않습니다.')
    const { data: info, error: iErr } = await admin.storage.from(ATTACH_BUCKET).info(path)
    if (iErr || !info) return err('Storage 에서 파일을 찾지 못했습니다. 다시 올려주세요.')
    const size = Number(info.size ?? 0)
    if (size > ATTACH_MAX_BYTES) {
      await admin.storage.from(ATTACH_BUCKET).remove([path])
      return err(`파일이 ${fmtBytes(ATTACH_MAX_BYTES)}를 넘습니다.`)
    }
    const int = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null)
    const { data: created, error } = await admin.from('attachments').insert({
      owner_type: t.ownerType, owner_id: t.ownerId, draft_key: t.draftKey, file_name: fileName, storage_path: path,
      mime: (info.contentType as string | undefined) ?? body.mime ?? null, size_bytes: size, width: int(body.width), height: int(body.height),
      uploaded_by: me.employeeId,
    }).select('id').single()
    if (error) {
      await admin.storage.from(ATTACH_BUCKET).remove([path])
      return fail(error.message)
    }
    return NextResponse.json({ ok: true, id: created.id })
  }
  return err('알 수 없는 작업입니다.')
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return err('로그인이 필요합니다.', 401)
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return err('대상이 올바르지 않습니다.')
  const admin = createAdminClient()
  const { data: att, error } = await admin.from('attachments')
    .select('id, owner_type, owner_id, uploaded_by, storage_path, deleted_at').eq('id', id).maybeSingle()
  if (error) return fail(error.message)
  if (!att || att.deleted_at) return err('파일을 찾을 수 없습니다.', 404)
  const rule = ATTACHMENT_OWNERS[att.owner_type]
  const allowed = att.owner_id ? !!rule && await rule.canDelete(me, att, admin) : att.uploaded_by === me.employeeId
  if (!allowed) return err('이 파일을 지울 권한이 없습니다. 올린 사람 · 마스터 계정만 지울 수 있습니다.', 403)
  const { error: rErr } = await admin.storage.from(ATTACH_BUCKET).remove([att.storage_path])
  if (rErr) return fail(rErr.message)
  if (!att.owner_id) {
    await admin.from('attachments').delete().eq('id', id)    // 저장 전 임시 파일 — 원본에 붙은 적이 없으므로 기록도 지운다
  } else {
    const { error: uErr } = await admin.from('attachments').update({ deleted_at: new Date().toISOString(), deleted_by: me.employeeId ?? null }).eq('id', id)
    if (uErr) return fail(uErr.message)
  }
  return NextResponse.json({ ok: true })
}
