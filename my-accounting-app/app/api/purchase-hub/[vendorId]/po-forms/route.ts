import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { recognizeForm } from '@/lib/po-form-recognize'
import { validateMapping } from '@/lib/po-vendor-form-fields'
import { PO_FORMS_BUCKET, PO_FORM_MAX_BYTES, PO_FORM_HINT, poFormMissing, loadFormFile } from '@/lib/po-vendor-form-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 업체 발주서 양식 (516) — 매입처 상세 '발주서 양식' 탭. 등록 · 수정 = 매입처 관리(customers) 수정 권한 (차단은 미들웨어, GET 외 = 수정)
// GET → { forms, recent_pos, can_edit } / GET ?download=<formId> → 원본 파일
// POST (FormData file, memo?) → 새 버전(작성 중) + 자동 인식
// PATCH { action: 'save' | 'activate' | 'archive' | 'copy', form_id, mapping?, memo? }
// DELETE ?form_id= → 작성 중 버전만 삭제

const COLS = 'id, vendor_id, version, file_name, status, mapping, recognized, memo, uploaded_at, activated_at, updated_at, uploader:employees!erp_po_forms_uploaded_by_fkey(name), activator:employees!erp_po_forms_activated_by_fkey(name)'
type Rel = { name: string } | { name: string }[] | null
const nameOf = (v: Rel) => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null

export async function GET(req: NextRequest, { params }: { params: { vendorId: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const download = new URL(req.url).searchParams.get('download')

  if (download) {
    const { data: f } = await admin.from('erp_po_forms').select('file_name, storage_path')
      .eq('id', download).eq('vendor_id', params.vendorId).maybeSingle()
    if (!f) return NextResponse.json({ error: '양식을 찾을 수 없습니다.' }, { status: 404 })
    const buf = await loadFormFile(admin, f.storage_path as string)
    if (!buf) return NextResponse.json({ error: '양식 파일을 읽지 못했습니다.' }, { status: 500 })
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name as string)}`,
      },
    })
  }

  const [forms, pos] = await Promise.all([
    admin.from('erp_po_forms').select(COLS).eq('vendor_id', params.vendorId).order('version', { ascending: false }),
    admin.from('erp_purchase_orders').select('id, po_no, created_at, total_amount')
      .eq('vendor_id', params.vendorId).eq('status', 'active').order('created_at', { ascending: false }).limit(15),
  ])
  const canEdit = can(me, 'customers', 'edit')
  if (forms.error) {
    if (poFormMissing(forms.error.message)) return NextResponse.json({ forms: [], recent_pos: [], can_edit: canEdit, hint: PO_FORM_HINT })
    return NextResponse.json({ error: forms.error.message }, { status: 500 })
  }
  return NextResponse.json({
    can_edit: canEdit,
    forms: (forms.data ?? []).map(f => ({
      ...f,
      uploader_name: nameOf(f.uploader as unknown as Rel), activator_name: nameOf(f.activator as unknown as Rel),
      uploader: undefined, activator: undefined,
    })),
    recent_pos: pos.data ?? [],
  })
}

export async function POST(req: NextRequest, { params }: { params: { vendorId: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('id').eq('id', params.vendorId).maybeSingle()
  if (!vendor) return NextResponse.json({ error: '매입처를 찾을 수 없습니다.' }, { status: 404 })

  const fd = await req.formData().catch(() => null)
  const file = fd?.get('file') as File | null
  const memo = String(fd?.get('memo') ?? '').trim() || null
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  const fileName = file.name.replace(/[/\\]/g, '_')
  if (/\.xls$/i.test(fileName)) {
    return NextResponse.json({ error: '.xls(옛 엑셀) 파일입니다. 엑셀에서 열어 [다른 이름으로 저장 → Excel 통합 문서(.xlsx)]로 바꿔 올려 주세요.' }, { status: 400 })
  }
  if (!/\.(xlsx|xlsm)$/i.test(fileName)) return NextResponse.json({ error: '엑셀(.xlsx) 파일만 올릴 수 있습니다.' }, { status: 400 })
  if (file.size > PO_FORM_MAX_BYTES) return NextResponse.json({ error: '파일이 10MB를 넘습니다.' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  let recognized
  try {
    recognized = await recognizeForm(buf)
  } catch (e) {
    return NextResponse.json({
      error: `엑셀을 읽지 못했습니다 — 엑셀에서 열어 .xlsx로 다시 저장한 뒤 올려 주세요. (${e instanceof Error ? e.message.slice(0, 80) : '알 수 없음'})`,
    }, { status: 400 })
  }

  const { data: last, error: lErr } = await admin.from('erp_po_forms').select('version')
    .eq('vendor_id', params.vendorId).order('version', { ascending: false }).limit(1).maybeSingle()
  if (lErr) return NextResponse.json({ error: poFormMissing(lErr.message) ? PO_FORM_HINT : lErr.message }, { status: 500 })
  const version = ((last?.version as number | undefined) ?? 0) + 1
  // Storage 키는 ASCII만 — 원본 파일명은 file_name에 보존
  const path = `${params.vendorId}/v${version}_${Date.now()}.xlsx`
  const { error: upErr } = await admin.storage.from(PO_FORMS_BUCKET).upload(path, buf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  if (upErr) return NextResponse.json({ error: poFormMissing(upErr.message) ? PO_FORM_HINT : `업로드 실패: ${upErr.message}` }, { status: 500 })

  const { data: created, error } = await admin.from('erp_po_forms').insert({
    vendor_id: params.vendorId, version, file_name: fileName, storage_path: path, status: 'draft',
    mapping: recognized.mapping, recognized, memo, uploaded_by: me.employeeId ?? null,
  }).select('id').single()
  if (error) {
    await admin.storage.from(PO_FORMS_BUCKET).remove([path])
    return NextResponse.json({ error: poFormMissing(error.message) ? PO_FORM_HINT : error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: created.id, version })
}

export async function PATCH(req: NextRequest, { params }: { params: { vendorId: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as { action?: string; form_id?: string; mapping?: unknown; memo?: string | null }
  if (!body.form_id) return NextResponse.json({ error: 'form_id가 필요합니다.' }, { status: 400 })
  const { data: form } = await admin.from('erp_po_forms').select('id, version, status, storage_path, file_name, mapping, recognized, memo')
    .eq('id', body.form_id).eq('vendor_id', params.vendorId).maybeSingle()
  if (!form) return NextResponse.json({ error: '양식을 찾을 수 없습니다.' }, { status: 404 })

  if (body.action === 'save') {
    // 사용 중 · 보관 버전은 그 버전으로 나간 발주서 기록이 있으므로 고치지 않는다 → '복사해 새 버전'
    if (form.status !== 'draft') return NextResponse.json({ error: '작성 중인 버전만 고칠 수 있습니다. 사용 중인 버전은 [복사해 새 버전]으로 고쳐 주세요.' }, { status: 400 })
    const v = validateMapping(body.mapping)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    const { error } = await admin.from('erp_po_forms').update({
      mapping: v.mapping, ...(body.memo !== undefined ? { memo: body.memo?.trim() || null } : {}),
    }).eq('id', form.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'activate') {
    if (form.status === 'active') return NextResponse.json({ ok: true })
    const v = validateMapping(form.mapping)
    if (!v.ok) return NextResponse.json({ error: `칸 연결을 먼저 마쳐 주세요 — ${v.error}` }, { status: 400 })
    const { data: prev } = await admin.from('erp_po_forms').select('id')
      .eq('vendor_id', params.vendorId).eq('status', 'active').maybeSingle()
    if (prev) {
      const { error } = await admin.from('erp_po_forms').update({ status: 'archived' }).eq('id', prev.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const { error } = await admin.from('erp_po_forms').update({
      status: 'active', activated_by: me.employeeId ?? null, activated_at: new Date().toISOString(),
    }).eq('id', form.id)
    if (error) {
      if (prev) await admin.from('erp_po_forms').update({ status: 'active' }).eq('id', prev.id)   // 되돌림
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'archive') {
    if (form.status !== 'active') return NextResponse.json({ error: '사용 중인 버전만 사용을 멈출 수 있습니다.' }, { status: 400 })
    const { error } = await admin.from('erp_po_forms').update({ status: 'archived' }).eq('id', form.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'copy') {
    const { data: last } = await admin.from('erp_po_forms').select('version')
      .eq('vendor_id', params.vendorId).order('version', { ascending: false }).limit(1).maybeSingle()
    const version = ((last?.version as number | undefined) ?? 0) + 1
    const path = `${params.vendorId}/v${version}_${Date.now()}.xlsx`
    const { error: cErr } = await admin.storage.from(PO_FORMS_BUCKET).copy(form.storage_path as string, path)
    if (cErr) return NextResponse.json({ error: `파일 복사 실패: ${cErr.message}` }, { status: 500 })
    const { data: created, error } = await admin.from('erp_po_forms').insert({
      vendor_id: params.vendorId, version, file_name: form.file_name, storage_path: path, status: 'draft',
      mapping: form.mapping, recognized: form.recognized, memo: `버전 ${form.version}에서 복사`, uploaded_by: me.employeeId ?? null,
    }).select('id').single()
    if (error) {
      await admin.storage.from(PO_FORMS_BUCKET).remove([path])
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: created.id, version })
  }

  return NextResponse.json({ error: '알 수 없는 작업입니다.' }, { status: 400 })
}

export async function DELETE(req: NextRequest, { params }: { params: { vendorId: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const id = new URL(req.url).searchParams.get('form_id')
  if (!id) return NextResponse.json({ error: 'form_id가 필요합니다.' }, { status: 400 })
  const { data: form } = await admin.from('erp_po_forms').select('id, status, storage_path')
    .eq('id', id).eq('vendor_id', params.vendorId).maybeSingle()
  if (!form) return NextResponse.json({ error: '양식을 찾을 수 없습니다.' }, { status: 404 })
  if (form.status !== 'draft') return NextResponse.json({ error: '작성 중인 버전만 지울 수 있습니다(사용했던 버전은 기록으로 남깁니다).' }, { status: 400 })
  const { error } = await admin.from('erp_po_forms').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await admin.storage.from(PO_FORMS_BUCKET).remove([form.storage_path as string])
  return NextResponse.json({ ok: true })
}
