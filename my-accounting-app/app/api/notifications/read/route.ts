import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// POST /api/notifications/read — 결과 통지(info) 확인 기록 (905, 2026-11-17). API_OWNERS: my(전원, /api/notifications 접두).
//  body: { keys: string[], all?: boolean }
//   keys = 확인한 알림 key (항목 '확인' · 바로가기 · 모두 확인 때 화면에 있던 결과 통지 전부)
//   all  = '모두 확인' — '*' 행에 지금 시각을 남겨 그 이전 결과 통지를 전부 숨긴다(목록에 안 보이던 오래된 것까지)
//  해야 할 것 · 기다리는 것은 화면에서 확인 버튼을 주지 않는다(GET 이 info 만 숨김).

const DAY = 86400_000
const MAX_KEYS = 100

export async function POST(req: Request) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!me.employeeId) return NextResponse.json({ error: '직원 정보가 없는 계정입니다.' }, { status: 400 })
  const body = await req.json().catch(() => null) as { keys?: unknown; all?: unknown } | null
  const keys = Array.isArray(body?.keys)
    ? Array.from(new Set(body!.keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 200 && k !== '*'))).slice(0, MAX_KEYS)
    : []
  const all = body?.all === true
  if (!keys.length && !all) return NextResponse.json({ error: '확인할 알림이 없습니다.' }, { status: 400 })

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const rows = [...keys, ...(all ? ['*'] : [])].map(item_key => ({ employee_id: me.employeeId!, item_key, read_at: now }))
  const { error } = await admin.from('notification_reads').upsert(rows, { onConflict: 'employee_id,item_key' })
  if (error) {
    const missing = /notification_reads/.test(error.message) && /(does not exist|schema cache|not find)/i.test(error.message)
    return NextResponse.json({ error: missing ? '알림 확인 기능 준비 중입니다(905 마이그레이션 실행 전).' : `저장 실패: ${error.message}` }, { status: missing ? 503 : 500 })
  }
  // 정리: 결과 통지는 최근 7일만 계산되므로 30일 지난 확인 기록은 필요 없다('*' 행은 upsert 로 갱신만)
  await admin.from('notification_reads').delete().eq('employee_id', me.employeeId).neq('item_key', '*').lt('read_at', new Date(Date.now() - 30 * DAY).toISOString())
  return NextResponse.json({ ok: true, saved: rows.length })
}
