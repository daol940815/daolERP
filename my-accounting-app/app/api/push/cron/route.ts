import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { OPEN_STATUSES, ASG_TRACKED, fmtDue, type WrStatus, type WrAsgStatus } from '@/lib/work-requests'
import { prefOn, type PushPrefs } from '@/lib/push'
import { pushConfigured, sendToSubscriptions } from '@/lib/push-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 아침 09:00 "오늘 마감 업무 요청" PC 알림 (업무요청 트랙 ⑦, 사용자 결정 ⑤ 09:00) — Vercel Cron 이 호출 (vercel.json: 0 0 * * * UTC = 09:00 KST)
// 인증: Vercel 이 보내는 Authorization: Bearer ${CRON_SECRET}. 로그인 세션이 없으므로 미들웨어는 이 경로를 통과시키고 여기서 비밀을 검사한다.
// 대상: wr_due_today 를 켠 구독이 있는 직원 중, 내 몫(미확인·수락·진행 중)이 오늘(KST) 마감인 요청이 있는 사람. 지난 건수는 본문에 덧붙인다.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET 환경변수가 설정되지 않았습니다.' }, { status: 503 })
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  if (!pushConfigured()) return NextResponse.json({ ok: false, reason: 'VAPID 키 미설정' })

  const admin = createAdminClient()
  const { data: subs, error } = await admin.from('push_subscriptions').select('id, employee_id, endpoint, p256dh, auth, prefs').eq('enabled', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  type Sub = { id: string; employee_id: string; endpoint: string; p256dh: string; auth: string; prefs: PushPrefs | null }
  const wanted = ((subs ?? []) as Sub[]).filter(s => prefOn(s.prefs, 'wr_due_today'))
  const empIds = Array.from(new Set(wanted.map(s => s.employee_id)))
  if (!empIds.length) return NextResponse.json({ ok: true, employees: 0, sent: 0 })

  type Share = { employee_id: string; status: WrAsgStatus; request: { id: string; title: string; due_at: string; status: WrStatus; is_private: boolean | null } | { id: string; title: string; due_at: string; status: WrStatus; is_private: boolean | null }[] | null }
  const { data: shares, error: sErr } = await admin.from('work_request_assignees')
    .select('employee_id, status, request:work_requests!inner(id, title, due_at, status, is_private)')
    .in('employee_id', empIds).in('status', ASG_TRACKED)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  const now = new Date()
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)
  const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(iso))
  const byEmp = new Map<string, { today: { title: string; due_at: string; is_private: boolean }[]; overdue: number }>()
  for (const s of (shares ?? []) as unknown as Share[]) {
    const r = Array.isArray(s.request) ? s.request[0] : s.request
    if (!r || !OPEN_STATUSES.includes(r.status)) continue
    const e = byEmp.get(s.employee_id) ?? { today: [], overdue: 0 }
    const due = new Date(r.due_at)
    if (due < now) e.overdue++
    else if (dayOf(r.due_at) === today) e.today.push({ title: r.title, due_at: r.due_at, is_private: !!r.is_private })
    byEmp.set(s.employee_id, e)
  }

  let sent = 0, employees = 0, failed = 0, removed = 0
  for (const [empId, e] of Array.from(byEmp.entries())) {
    if (!e.today.length) continue
    employees++
    e.today.sort((a: { due_at: string }, b: { due_at: string }) => a.due_at.localeCompare(b.due_at))
    const first = e.today[0]
    const head = first.is_private ? '비공개 업무 요청' : first.title
    const body = `${head} (${fmtDue(first.due_at).slice(6)}까지)${e.today.length > 1 ? ` 외 ${e.today.length - 1}건` : ''}${e.overdue ? ` · 마감 지난 요청 ${e.overdue}건` : ''}`
    const r = await sendToSubscriptions(admin, wanted.filter(s => s.employee_id === empId), {
      kind: 'wr_due_today', title: `오늘 마감 업무 요청 ${e.today.length}건`, body, url: '/me/requests?filter=due_today', tag: `due:${today}`,
    })
    sent += r.sent; failed += r.failed; removed += r.removed
  }
  return NextResponse.json({ ok: true, date: today, employees, sent, failed, removed })
}
