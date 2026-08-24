import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 발주 메일 프리셋 (510) — 전 직원 공용. 발송 페이지·프리셋 관리 모달에서 사용.
// GET → { presets } (기본 프리셋 우선 정렬)
// POST { action: 'create'|'update'|'delete'|'set_default', id?, name?, subject?, body? }

const HINT = '510 마이그레이션(발주서 발송 페이지)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missing = (msg: string) => /erp_po_mail_presets|relation|does not exist/i.test(msg)

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('erp_po_mail_presets')
    .select('id, name, subject, body, is_default, updated_at, editor:employees!erp_po_mail_presets_updated_by_fkey(name)')
    .order('is_default', { ascending: false }).order('name')
  if (error) return NextResponse.json({ error: missing(error.message) ? HINT : error.message }, { status: 500 })
  return NextResponse.json({
    presets: (data ?? []).map(p => ({
      ...p,
      editor_name: (p.editor as unknown as { name: string } | null)?.name ?? null,
      editor: undefined,
    })),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => null) as {
    action?: string; id?: string; name?: string; subject?: string; body?: string
  } | null
  if (!body?.action) return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })

  if (body.action === 'create' || body.action === 'update') {
    const name = (body.name ?? '').trim()
    const subject = (body.subject ?? '').trim()
    const text = (body.body ?? '').trim()
    if (!name) return NextResponse.json({ error: '프리셋 이름을 입력해주세요.' }, { status: 400 })
    if (!subject || !text) return NextResponse.json({ error: '제목과 본문을 입력해주세요.' }, { status: 400 })

    if (body.action === 'create') {
      // 첫 프리셋이면 기본으로 지정
      const { count } = await admin.from('erp_po_mail_presets').select('id', { count: 'exact', head: true })
      const { data, error } = await admin.from('erp_po_mail_presets')
        .insert({ name, subject, body: text, is_default: (count ?? 0) === 0, updated_by: me.employeeId ?? null })
        .select('id').single()
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return NextResponse.json({ error: `같은 이름의 프리셋이 이미 있습니다: ${name}` }, { status: 409 })
        }
        return NextResponse.json({ error: missing(error.message) ? HINT : error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, id: data.id })
    }

    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('erp_po_mail_presets')
      .update({ name, subject, body: text, updated_by: me.employeeId ?? null }).eq('id', body.id)
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return NextResponse.json({ error: `같은 이름의 프리셋이 이미 있습니다: ${name}` }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete') {
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('erp_po_mail_presets').delete().eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_default') {
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    // 기존 기본 해제 → 새 기본 지정 (부분 유니크 인덱스와 순서 맞춤)
    const { error: e1 } = await admin.from('erp_po_mail_presets')
      .update({ is_default: false }).eq('is_default', true)
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    const { error: e2 } = await admin.from('erp_po_mail_presets')
      .update({ is_default: true }).eq('id', body.id)
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
