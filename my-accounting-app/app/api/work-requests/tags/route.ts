import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { WR_TAG_COLORS, WR_TAG_ACTIVE_MAX, type WrTag } from '@/lib/work-requests'
import { loadTags, hintFor, MIGRATION_HINT_904 } from '@/lib/work-requests-server'

export const dynamic = 'force-dynamic'

// 업무 요청 태그 마스터 (904, 2026-11-10) — API_OWNERS: /api/work-requests → my(전원). 추가 · 수정은 마스터 계정만(여기서 판정).
//  GET   [?usage=1]                         — 태그 전체(숨김 포함, 순서대로). usage=1 이면 태그별 사용 건수 포함(관리 화면)
//  POST  { label, color, keywords[] }       — 추가 (마스터). 사용 중 태그는 최대 12개.
//  PATCH { id, label?, color?, keywords?, active?, move?: up|down } — 이름 · 색 · 키워드 · 숨김 · 순서 (마스터)
//  삭제는 없다 — 숨김(active=false)만. 숨긴 태그는 새 요청에서 못 고르고 과거 요청 · 통계에는 남는다.

const LABEL_MAX = 20
const cleanKeywords = (v: unknown) => Array.from(new Set(
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => String(x).trim()).filter(Boolean),
)).slice(0, 30)
const dupMsg = (msg: string) => /duplicate key|uq_work_request_tags_label/i.test(msg) ? '같은 이름의 태그가 이미 있습니다(숨긴 태그 포함).' : hintFor(msg)

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const tags = await loadTags(admin)
  const base = { tags, ready: tags.length > 0, can_manage: me.isMaster, active_max: WR_TAG_ACTIVE_MAX }
  if (req.nextUrl.searchParams.get('usage') !== '1' || !tags.length) return NextResponse.json(base)
  // 태그별 사용 건수 — 태그 수가 적으므로 태그마다 count (1000행 제한과 무관)
  const counts = await Promise.all(tags.map(t => admin.from('work_request_tag_links').select('request_id', { count: 'exact', head: true }).eq('tag_id', t.id)))
  const usage = Object.fromEntries(tags.map((t, i) => [t.id, counts[i].count ?? 0]))
  return NextResponse.json({ ...base, usage })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.isMaster) return NextResponse.json({ error: '태그 추가는 마스터 계정만 할 수 있습니다. ERP 총괄 담당자에게 요청하세요.' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { label?: string; color?: string; keywords?: unknown }
  const label = (body.label ?? '').trim()
  if (!label) return NextResponse.json({ error: '태그 이름을 입력하세요.' }, { status: 400 })
  if (label.length > LABEL_MAX) return NextResponse.json({ error: `태그 이름은 ${LABEL_MAX}자까지입니다.` }, { status: 400 })
  const color = WR_TAG_COLORS.some(c => c.key === body.color) ? body.color! : 'slate'
  const admin = createAdminClient()
  const tags = await loadTags(admin)
  if (!tags.length) return NextResponse.json({ error: MIGRATION_HINT_904 }, { status: 500 })
  if (tags.filter(t => t.active).length >= WR_TAG_ACTIVE_MAX) return NextResponse.json({ error: `사용 중인 태그는 최대 ${WR_TAG_ACTIVE_MAX}개입니다. 안 쓰는 태그를 숨긴 뒤 추가하세요.` }, { status: 400 })
  const sort = Math.max(0, ...tags.map(t => t.sort)) + 10
  const { data, error } = await admin.from('work_request_tags').insert({ label, color, keywords: cleanKeywords(body.keywords), sort }).select('id').single()
  if (error) return NextResponse.json({ error: dupMsg(error.message) }, { status: 400 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.isMaster) return NextResponse.json({ error: '태그 수정은 마스터 계정만 할 수 있습니다. ERP 총괄 담당자에게 요청하세요.' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { id?: string; label?: string; color?: string; keywords?: unknown; active?: boolean; move?: string }
  const admin = createAdminClient()
  const tags = await loadTags(admin)
  if (!tags.length) return NextResponse.json({ error: MIGRATION_HINT_904 }, { status: 500 })
  const tag = tags.find(t => t.id === body.id)
  if (!tag) return NextResponse.json({ error: '태그를 찾을 수 없습니다.' }, { status: 404 })

  // 순서 이동 — 사용 중인 태그끼리 이웃과 순서 값을 맞바꾼다
  if (body.move === 'up' || body.move === 'down') {
    const act = tags.filter(t => t.active)
    const i = act.findIndex(t => t.id === tag.id)
    const other: WrTag | undefined = i < 0 ? undefined : act[body.move === 'up' ? i - 1 : i + 1]
    if (!other) return NextResponse.json({ ok: true })
    const [a, b] = other.sort === tag.sort ? [tag.sort + (body.move === 'up' ? -1 : 1), tag.sort] : [other.sort, tag.sort]
    const r1 = await admin.from('work_request_tags').update({ sort: a }).eq('id', tag.id)
    const r2 = await admin.from('work_request_tags').update({ sort: b }).eq('id', other.id)
    if (r1.error || r2.error) return NextResponse.json({ error: hintFor((r1.error ?? r2.error)!.message) }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const patch: Record<string, unknown> = {}
  if (body.label !== undefined) {
    const label = body.label.trim()
    if (!label) return NextResponse.json({ error: '태그 이름을 입력하세요.' }, { status: 400 })
    if (label.length > LABEL_MAX) return NextResponse.json({ error: `태그 이름은 ${LABEL_MAX}자까지입니다.` }, { status: 400 })
    patch.label = label
  }
  if (body.color !== undefined) {
    if (!WR_TAG_COLORS.some(c => c.key === body.color)) return NextResponse.json({ error: '고를 수 없는 색입니다.' }, { status: 400 })
    patch.color = body.color
  }
  if (body.keywords !== undefined) patch.keywords = cleanKeywords(body.keywords)
  if (typeof body.active === 'boolean' && body.active !== tag.active) {
    const activeCount = tags.filter(t => t.active).length
    if (body.active && activeCount >= WR_TAG_ACTIVE_MAX) return NextResponse.json({ error: `사용 중인 태그는 최대 ${WR_TAG_ACTIVE_MAX}개입니다.` }, { status: 400 })
    if (!body.active && activeCount <= 1) return NextResponse.json({ error: '사용 중인 태그가 하나는 있어야 합니다.' }, { status: 400 })
    patch.active = body.active
    if (body.active) patch.sort = Math.max(0, ...tags.map(t => t.sort)) + 10   // 다시 사용 = 맨 뒤로
  }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true })
  const { error } = await admin.from('work_request_tags').update(patch).eq('id', tag.id)
  if (error) return NextResponse.json({ error: dupMsg(error.message) }, { status: 400 })
  return NextResponse.json({ ok: true })
}
