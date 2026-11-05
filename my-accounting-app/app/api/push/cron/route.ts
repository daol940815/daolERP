import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { OPEN_STATUSES, ASG_TRACKED, fmtDue, type WrStatus, type WrAsgStatus } from '@/lib/work-requests'
import { prefOn, type PushPrefs } from '@/lib/push'
import { pushConfigured, sendToSubscriptions, sendPush } from '@/lib/push-server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadReplyMap, REPLY_START } from '@/lib/order-reply'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 아침 09:00 "오늘 마감 업무 요청" PC 알림 (업무요청 트랙 ⑦, 사용자 결정 ⑤ 09:00) — Vercel Cron 이 호출 (vercel.json: 0 0 * * * UTC = 09:00 KST)
// 인증: Vercel 이 보내는 Authorization: Bearer ${CRON_SECRET}. 로그인 세션이 없으므로 미들웨어는 이 경로를 통과시키고 여기서 비밀을 검사한다.
// 대상: wr_due_today 를 켠 구독이 있는 직원 중, 내 몫(미확인·수락·진행 중)이 오늘(KST) 마감인 요청이 있는 사람. 지난 건수는 본문에 덧붙인다.
// 상담일지 주문 진행 요청 재알림 (705, 주문 트랙 2026-11-05 사용자 확정): 어제 이전에 요청됐는데 아직 전환 안 된 상담 →
// 담당자에게 1회(order_reminded_at 기록). 705 미적용이면 건너뜀. 알림 종류 order_req 설정을 따른다.
// 완료 회신 대기 재알림 (515, 2026-11-05): 어제 이전 입력 · 회신 안 한 주문 → 입력자에게 주문당 1회. 알림 종류 order_reply_wait.
async function remindOrderRequests(admin: SupabaseClient): Promise<{ consults: number; sent: number }> {
  const todayKst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const startOfToday = new Date(`${todayKst}T00:00:00+09:00`).toISOString()
  const { data, error } = await admin.from('erp_consultations')
    .select('id, bank_name, branch_name, order_assignee_id')
    .eq('status', '진행중').not('order_assignee_id', 'is', null)
    .is('order_reminded_at', null).lt('order_requested_at', startOfToday)
  if (error || !data?.length) return { consults: 0, sent: 0 }
  const byEmp = new Map<string, typeof data>()
  for (const c of data) byEmp.set(c.order_assignee_id as string, [...(byEmp.get(c.order_assignee_id as string) ?? []), c])
  let sent = 0
  for (const [empId, cs] of Array.from(byEmp.entries())) {
    const where = [cs[0].bank_name, cs[0].branch_name].filter(Boolean).join(' ') || '상담일지'
    const r = await sendPush(admin, [empId], {
      kind: 'order_req', title: `처리 안 된 주문 진행 요청 ${cs.length}건`,
      body: `${where}${cs.length > 1 ? ` 외 ${cs.length - 1}건` : ''}`,
      url: '/orders/consultations?scope=assigned', tag: `order_req_remind:${todayKst}`,
    }).catch(() => null)
    sent += r?.sent ?? 0
  }
  await admin.from('erp_consultations').update({ order_reminded_at: new Date().toISOString() }).in('id', data.map(c => c.id as string))
  return { consults: data.length, sent }
}

// 완료 회신 대기 (515) — 입력 다음 날 아침까지 회신 안 한 주문을 입력자에게 1회 (주문당 1회, erp_order_reply_reminders)
async function remindReplyWaiting(admin: SupabaseClient): Promise<{ orders: number; sent: number }> {
  const todayKst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const startOfToday = new Date(`${todayKst}T00:00:00+09:00`).toISOString()
  const { data: os, error } = await admin.from('erp_orders')
    .select('id, order_no, bank_name, branch_name, created_by_employee_id')
    .eq('source', 'direct').is('canceled_at', null)
    .gte('created_at', REPLY_START).lt('created_at', startOfToday).limit(2000)
  if (error || !os?.length) return { orders: 0, sent: 0 }
  const reminded = new Set<string>()
  for (let i = 0; i < os.length; i += 150) {
    const { data, error: rErr } = await admin.from('erp_order_reply_reminders').select('order_id').in('order_id', os.slice(i, i + 150).map(o => o.id as string))
    if (rErr) return { orders: 0, sent: 0 }   // 515 미적용
    for (const r of data ?? []) reminded.add(r.order_id as string)
  }
  const cands = os.filter(o => !reminded.has(o.id as string) && o.created_by_employee_id)
  const rm = await loadReplyMap(admin, cands.map(o => o.id as string))
  const waiting = cands.filter(o => rm.get(o.id as string)?.state === 'waiting')
  if (!waiting.length) return { orders: 0, sent: 0 }
  const byEmp = new Map<string, typeof waiting>()
  for (const o of waiting) byEmp.set(o.created_by_employee_id as string, [...(byEmp.get(o.created_by_employee_id as string) ?? []), o])
  let sent = 0
  for (const [empId, list] of Array.from(byEmp.entries())) {
    const where = [list[0].bank_name, list[0].branch_name].filter(Boolean).join(' ') || '주문'
    const r = await sendPush(admin, [empId], {
      kind: 'order_reply_wait', title: `회신 안 한 주문 ${list.length}건`,
      body: `${where} · ${list[0].order_no ?? ''}${list.length > 1 ? ` 외 ${list.length - 1}건` : ''}`,
      url: '/orders?reply=my_wait', tag: `order_reply_wait:${todayKst}`,
    }).catch(() => null)
    sent += r?.sent ?? 0
  }
  await admin.from('erp_order_reply_reminders').upsert(waiting.map(o => ({ order_id: o.id as string })), { onConflict: 'order_id', ignoreDuplicates: true })
  return { orders: waiting.length, sent }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET 환경변수가 설정되지 않았습니다.' }, { status: 503 })
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: '인증 실패' }, { status: 401 })
  if (!pushConfigured()) return NextResponse.json({ ok: false, reason: 'VAPID 키 미설정' })

  const admin = createAdminClient()
  const orderReminders = await remindOrderRequests(admin).catch(() => ({ consults: 0, sent: 0 }))
  const replyReminders = await remindReplyWaiting(admin).catch(() => ({ orders: 0, sent: 0 }))
  const { data: subs, error } = await admin.from('push_subscriptions').select('id, employee_id, endpoint, p256dh, auth, prefs').eq('enabled', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  type Sub = { id: string; employee_id: string; endpoint: string; p256dh: string; auth: string; prefs: PushPrefs | null }
  const wanted = ((subs ?? []) as Sub[]).filter(s => prefOn(s.prefs, 'wr_due_today'))
  const empIds = Array.from(new Set(wanted.map(s => s.employee_id)))
  if (!empIds.length) return NextResponse.json({ ok: true, employees: 0, sent: 0, order_reminders: orderReminders, reply_reminders: replyReminders })

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
  return NextResponse.json({ ok: true, date: today, employees, sent, failed, removed, order_reminders: orderReminders, reply_reminders: replyReminders })
}
