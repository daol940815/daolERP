import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { editKeyword, loadKeywordAdmin, type KeywordTab } from '@/lib/keyword-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 키워드 관리 (2026-11-26) — 점검 · 정리 도구
//   GET   ?tab=bank|invoice                     → 거래처별 키워드 · 걸린 수(최근 6개월) · 겹침 · 의심
//   PATCH { tab, vendor_id, add? | remove? }     → 키워드 추가 · 삭제(점검 · 정리 도구 수정 — 미들웨어가 막는다)
const tabOf = (v: unknown): KeywordTab | null => (v === 'bank' || v === 'invoice' ? v : null)

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const tab = tabOf(new URL(req.url).searchParams.get('tab')) ?? 'bank'
  const r = await loadKeywordAdmin(createAdminClient(), tab)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ...r, can_edit: can(me, 'tools', 'edit') })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { tab?: string; vendor_id?: string; add?: string; remove?: string }
  const tab = tabOf(body.tab)
  if (!tab || !body.vendor_id) return NextResponse.json({ error: 'tab · vendor_id가 필요합니다.' }, { status: 400 })
  const r = await editKeyword(createAdminClient(), tab, body.vendor_id, { add: body.add, remove: body.remove })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
