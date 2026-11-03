import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { PUSH_KINDS, type PushPrefs, type PushSubRow } from '@/lib/push'
import { vapidPublicKey, pushConfigured, sendToSubscriptions } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

// PC 알림(Web Push) 구독 — 내 업무(전원). API_OWNERS: /api/push → my
//  GET                      → 내 구독(기기) 목록 + VAPID 공개키 + 설정 여부 + 승인권자 여부
//  POST { action: 'subscribe', endpoint, keys{p256dh,auth}, user_agent?, device_label? } → 이 브라우저 구독 저장(갱신)
//  POST { action: 'test', endpoint? }                                                → 테스트 알림 1건 (endpoint 없으면 내 켜진 기기 전부)
//  PATCH { id, enabled?, prefs?, device_label? }                                     → 기기 설정 변경 (내 것만)
//  DELETE { id | endpoint }                                                          → 구독 삭제 (내 것만)
const MIGRATION_HINT = '903 마이그레이션(PC 알림 구독)이 아직 적용되지 않았습니다. SQL 편집기에서 903_push_subscriptions.sql을 실행해주세요.'
const isMissing = (m: string) => /push_subscriptions/i.test(m)
const COLS = 'id, endpoint, device_label, user_agent, enabled, prefs, last_used_at, last_error, created_at'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const base = { vapidPublicKey: vapidPublicKey(), configured: pushConfigured(), approver: isManagerLike(me), kinds: PUSH_KINDS }
  if (!me.employeeId) return NextResponse.json({ ...base, linked: false, subscriptions: [] })
  const admin = createAdminClient()
  const { data, error } = await admin.from('push_subscriptions').select(COLS).eq('employee_id', me.employeeId).order('created_at')
  if (error) return NextResponse.json({ ...base, linked: true, subscriptions: [], warning: isMissing(error.message) ? MIGRATION_HINT : error.message })
  return NextResponse.json({ ...base, linked: true, subscriptions: (data ?? []) as PushSubRow[] })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { action?: string; endpoint?: string; keys?: { p256dh?: string; auth?: string }; user_agent?: string; device_label?: string }
  const admin = createAdminClient()

  if (body.action === 'subscribe') {
    const endpoint = (body.endpoint ?? '').trim()
    const p256dh = body.keys?.p256dh ?? '', auth = body.keys?.auth ?? ''
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return NextResponse.json({ error: '구독 정보가 올바르지 않습니다.' }, { status: 400 })
    // 같은 endpoint 가 이미 있으면(같은 브라우저 재허용·다른 직원이 같은 PC에서 로그인) 내 것으로 갱신
    const { data: exist } = await admin.from('push_subscriptions').select('id, employee_id, prefs, device_label').eq('endpoint', endpoint).maybeSingle()
    const row = { employee_id: me.employeeId, endpoint, p256dh, auth, user_agent: (body.user_agent ?? '').slice(0, 300) || null, enabled: true, updated_at: new Date().toISOString(), last_error: null }
    const res = exist
      ? await admin.from('push_subscriptions').update({ ...row, ...(exist.employee_id !== me.employeeId ? { prefs: {}, device_label: body.device_label ?? null } : {}) }).eq('id', exist.id).select('id').single()
      : await admin.from('push_subscriptions').insert({ ...row, device_label: (body.device_label ?? '').slice(0, 80) || null, prefs: {} }).select('id').single()
    if (res.error) return NextResponse.json({ error: isMissing(res.error.message) ? MIGRATION_HINT : res.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: res.data.id })
  }

  if (body.action === 'test') {
    if (!pushConfigured()) return NextResponse.json({ error: '서버에 알림 키(VAPID)가 설정되지 않았습니다.' }, { status: 503 })
    let q = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('employee_id', me.employeeId).eq('enabled', true)
    if (body.endpoint) q = q.eq('endpoint', body.endpoint)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: isMissing(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
    if (!data?.length) return NextResponse.json({ error: '켜진 구독(기기)이 없습니다. 먼저 이 PC에서 알림을 허용하세요.' }, { status: 400 })
    const r = await sendToSubscriptions(admin, data, { kind: 'wr_new', title: 'daolERP 테스트 알림', body: `${me.employeeName ?? ''} — PC 알림이 정상 동작합니다. 웹을 닫아도 이렇게 뜹니다.`, url: '/me/profile?tab=notify', tag: 'test' })
    return NextResponse.json({ ok: true, ...r })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { id?: string; enabled?: boolean; prefs?: PushPrefs; device_label?: string }
  if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (body.prefs && typeof body.prefs === 'object') {
    const clean: PushPrefs = {}
    for (const k of PUSH_KINDS) if (typeof body.prefs[k] === 'boolean') clean[k] = body.prefs[k]
    patch.prefs = clean
  }
  if (typeof body.device_label === 'string') patch.device_label = body.device_label.trim().slice(0, 80) || null
  const admin = createAdminClient()
  const { data, error } = await admin.from('push_subscriptions').update(patch).eq('id', body.id).eq('employee_id', me.employeeId).select('id')
  if (error) return NextResponse.json({ error: isMissing(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: '내 구독이 아니거나 없습니다.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보와 연결되지 않은 계정입니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { id?: string; endpoint?: string }
  if (!body.id && !body.endpoint) return NextResponse.json({ error: 'id 또는 endpoint가 필요합니다.' }, { status: 400 })
  const admin = createAdminClient()
  let q = admin.from('push_subscriptions').delete().eq('employee_id', me.employeeId)
  q = body.id ? q.eq('id', body.id) : q.eq('endpoint', body.endpoint!)
  const { error } = await q
  if (error) return NextResponse.json({ error: isMissing(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
