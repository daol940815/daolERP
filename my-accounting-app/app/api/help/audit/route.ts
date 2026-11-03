import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { OPEN_STATUSES } from '@/lib/work-requests'
import { HELP_QUESTION_PREFIX, HELP_PERMISSION_PREFIX } from '@/lib/help-registry'

export const dynamic = 'force-dynamic'

// 도움말 점검 (마스터) — 최근 30일 [질문] · [권한] 업무 요청을 화면별로 센다. 제목 "[질문] 화면명 — …" 에서 화면명을 뽑는다.
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.isMaster) return NextResponse.json({ error: '마스터 계정만 볼 수 있습니다.' }, { status: 403 })
  const admin = createAdminClient()
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data, error } = await admin.from('work_requests').select('title, status, created_at')
    .gte('created_at', since).or(`title.like.${HELP_QUESTION_PREFIX}%,title.like.${HELP_PERMISSION_PREFIX}%`).limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const by = new Map<string, { screen: string; count: number; open: number }>()
  for (const r of (data ?? []) as { title: string; status: string }[]) {
    const screen = r.title.replace(/^\[[^\]]+\]\s*/, '').split(' — ')[0].trim() || '(화면 미상)'
    const x = by.get(screen) ?? { screen, count: 0, open: 0 }
    x.count++; if (OPEN_STATUSES.includes(r.status as never)) x.open++
    by.set(screen, x)
  }
  const questions = Array.from(by.values()).sort((a, b) => b.count - a.count)
  return NextResponse.json({ since: since.slice(0, 10), questions, total: (data ?? []).length })
}
