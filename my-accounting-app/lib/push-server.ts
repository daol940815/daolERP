// PC 알림(Web Push) — 서버 발송 (업무요청 트랙 ⑦, 2026-11-03). 서버 전용(web-push + 서비스 키).
//  sendPush(admin, employeeIds, payload): 그 직원들의 켜진 구독 중 payload.kind 를 받기로 한 기기에 전부 발송.
//  구독이 사라진 기기(404·410)는 행을 지운다. 실패해도 호출한 본 작업에는 영향 없음(모두 삼킨다).
//  VAPID 키는 환경변수 VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT(mailto:). 없으면 조용히 건너뛴다.

import type { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { prefOn, type PushPayload, type PushPrefs } from '@/lib/push'

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? ''
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

let configured = false
function ensureVapid(): boolean {
  if (!pushConfigured()) return false
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:daol940815@gmail.com', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)
    configured = true
  }
  return true
}

type SubRow = { id: string; employee_id: string; endpoint: string; p256dh: string; auth: string; prefs: PushPrefs | null }

export interface SendResult { sent: number; failed: number; removed: number; skipped: boolean }

export async function sendPush(admin: SupabaseClient, employeeIds: (string | null | undefined)[], payload: PushPayload): Promise<SendResult> {
  const ids = Array.from(new Set(employeeIds.filter((x): x is string => !!x)))
  const none: SendResult = { sent: 0, failed: 0, removed: 0, skipped: true }
  if (!ids.length || !ensureVapid()) return none
  const { data, error } = await admin.from('push_subscriptions').select('id, employee_id, endpoint, p256dh, auth, prefs').in('employee_id', ids).eq('enabled', true)
  if (error || !data?.length) return none   // 903 미적용·구독 없음 → 조용히
  const targets = (data as SubRow[]).filter(s => prefOn(s.prefs, payload.kind))
  if (!targets.length) return none
  return sendToSubscriptions(admin, targets, payload)
}

// 특정 구독 행들에 직접 발송 (테스트 알림·아침 마감 알림)
export async function sendToSubscriptions(admin: SupabaseClient, subs: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload): Promise<SendResult> {
  if (!ensureVapid()) return { sent: 0, failed: 0, removed: 0, skipped: true }
  const body = JSON.stringify(payload)
  const now = new Date().toISOString()
  const r: SendResult = { sent: 0, failed: 0, removed: 0, skipped: false }
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 12, urgency: 'high' })
      r.sent++
      await admin.from('push_subscriptions').update({ last_used_at: now, last_error: null }).eq('id', s.id)
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        r.removed++
        await admin.from('push_subscriptions').delete().eq('id', s.id)   // 브라우저에서 구독이 사라짐
      } else {
        r.failed++
        await admin.from('push_subscriptions').update({ last_error: `${status ?? ''} ${(e as Error).message ?? ''}`.trim().slice(0, 300) }).eq('id', s.id)
      }
    }
  }))
  return r
}

// 승인권자 목록 — 알림 API의 isManagerLike 와 같은 기준(마스터 · 승인권 · sales 외 role), 재직 · 로그인 계정 있는 직원
export async function approverIds(admin: SupabaseClient, except?: string | null): Promise<string[]> {
  const { data } = await admin.from('employees').select('id, role, is_master, can_approve, work_end')
    .eq('is_active', true).not('login_id', 'is', null)
    .or('is_master.eq.true,can_approve.eq.true,role.neq.sales')
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  return ((data ?? []) as { id: string; work_end: string | null }[])
    .filter(e => e.id !== except && !(typeof e.work_end === 'string' && e.work_end < today))
    .map(e => e.id)
}
