import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { encodeUiPrefs, normalizeUiPrefs, UI_PREFS_COOKIE } from '@/lib/ui-prefs'

export const dynamic = 'force-dynamic'

// 내 화면 설정 (글자 크기 · 색 테마, 113) — 본인만. API_OWNERS: /api/me → my(전원)
//  GET   → { prefs, ready }   (ready=false 면 113 미적용 — 이 브라우저에만 저장됨)
//  PATCH { fontScale?, theme? } → 저장 + 쿠키 사본 갱신
const isMissing = (m: string) => /ui_prefs/i.test(m)

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ prefs: normalizeUiPrefs({}), ready: false })
  const { data, error } = await createAdminClient().from('employees').select('ui_prefs').eq('id', me.employeeId).maybeSingle()
  if (error) return NextResponse.json({ prefs: normalizeUiPrefs({}), ready: false, warning: isMissing(error.message) ? '113 마이그레이션 적용 전 — 설정이 이 브라우저에만 저장됩니다.' : error.message })
  return NextResponse.json({ prefs: normalizeUiPrefs((data as { ui_prefs: unknown } | null)?.ui_prefs), ready: true })
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const prefs = normalizeUiPrefs(body)
  let saved = false, warning: string | null = null
  if (me.employeeId) {
    const { error } = await createAdminClient().from('employees').update({ ui_prefs: prefs }).eq('id', me.employeeId)
    if (error && !isMissing(error.message)) return NextResponse.json({ error: error.message }, { status: 500 })
    saved = !error
    if (error) warning = '113 마이그레이션 적용 전 — 설정이 이 브라우저에만 저장됩니다.'
  } else warning = '직원 정보와 연결되지 않은 계정 — 이 브라우저에만 저장됩니다.'
  const res = NextResponse.json({ ok: true, prefs, saved, warning })
  res.cookies.set(UI_PREFS_COOKIE, encodeUiPrefs(prefs), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  return res
}
