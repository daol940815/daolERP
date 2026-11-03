'use client'

// PC 알림(Web Push) — 브라우저 쪽 도우미 (업무요청 트랙 ⑦, 2026-11-03)
//  지원 여부 · 현재 브라우저의 구독 상태 · 허용(구독 → 서버 저장) · 해제. VAPID 공개키는 서버(/api/push/subscriptions GET)가 준다
//  (NEXT_PUBLIC 빌드 변수에 묶지 않아 Vercel 환경변수만 넣으면 재빌드 없이 동작).

import { deviceLabelFrom, PUSH_LATER_KEY, PUSH_LATER_DAYS } from '@/lib/push'

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'ready'   // ready = 지원하고 아직 구독 안 함

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function registration() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  return reg
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    return reg ? await reg.pushManager.getSubscription() : null
  } catch { return null }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return (await currentSubscription()) ? 'subscribed' : 'ready'
}

function toKey(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

// 허용 → 구독 → 서버 저장. 실패 사유를 문자열로 돌려준다(성공이면 null).
export async function enablePush(vapidPublicKey: string): Promise<string | null> {
  if (!pushSupported()) return '이 브라우저는 PC 알림을 지원하지 않습니다.'
  if (!vapidPublicKey) return '서버에 알림 키(VAPID)가 설정되지 않았습니다. ERP 관리자에게 알려주세요.'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? '브라우저에서 알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 → 알림 허용으로 바꾼 뒤 다시 시도하세요.' : '알림 허용을 취소했습니다.'
  try {
    const reg = await registration()
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapidPublicKey) as BufferSource })
    const json = sub.toJSON()
    const res = await fetch('/api/push/subscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'subscribe', endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent, device_label: deviceLabelFrom(navigator.userAgent) }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return j.error ?? '구독 저장에 실패했습니다.'
    try { localStorage.removeItem(PUSH_LATER_KEY) } catch { /* 무시 */ }
    return null
  } catch (e) {
    return `구독에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`
  }
}

// 이 브라우저의 구독 해제 (서버 행 삭제 + 브라우저 구독 취소)
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  try { await fetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }) } catch { /* 무시 */ }
  try { await sub.unsubscribe() } catch { /* 무시 */ }
}

export function laterActive(): boolean {
  try { const v = localStorage.getItem(PUSH_LATER_KEY); return !!v && Date.now() < Number(v) } catch { return false }
}
export function setLater() {
  try { localStorage.setItem(PUSH_LATER_KEY, String(Date.now() + PUSH_LATER_DAYS * 86400_000)) } catch { /* 무시 */ }
}
