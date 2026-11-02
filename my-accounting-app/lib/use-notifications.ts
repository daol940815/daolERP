'use client'

// 알림 폴링 훅 — NOTIF_POLL_MS(20초)마다 /api/notifications. 직전 결과와 비교해 새로 생긴(또는 건수가 늘어난) 항목을 토스트로 올린다.
// 첫 응답은 토스트 없이(로그인 직후는 '확인할 것' 패널이 담당). 확인함(seenAt)은 localStorage.
// 결과가 직전과 달라지면 window 이벤트(NOTIF_CHANGED)를 쏴서 열린 화면(업무 요청 목록·상세·대시보드)이 자기 데이터를 다시 조회한다.
// 화면 조작 뒤 requestNotifRefresh() 가 오면 즉시 한 번 폴링한다. (⑥ 1단계, 2026-11-02)

import { useCallback, useEffect, useRef, useState } from 'react'
import { NOTIF_POLL_MS, NOTIF_SEEN_KEY, type NotifData, type NotifItem } from '@/lib/notifications'
import { NOTIF_CHANGED, NOTIF_REFRESH_REQUEST } from '@/lib/use-notif-refresh'

export interface Toast { id: string; item: NotifItem }
const TOAST_MS = 8000
const TOAST_MAX = 2

export function useNotifications(enabled = true) {
  const [data, setData] = useState<NotifData | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [seenAt, setSeenAt] = useState<string | null>(null)
  const prev = useRef<Map<string, number> | null>(null)
  const prevSig = useRef<string | null>(null)

  useEffect(() => { try { setSeenAt(localStorage.getItem(NOTIF_SEEN_KEY)) } catch { /* 무시 */ } }, [])

  const dismiss = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), [])

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as NotifData
      setData(json)
      const cur = new Map(json.items.map(i => [i.key, i.count]))
      if (prev.current) {
        const fresh = json.items.filter(i => (prev.current!.get(i.key) ?? 0) < i.count)
        if (fresh.length) {
          setToasts(t => [...fresh.map(i => ({ id: `${i.key}:${Date.now()}`, item: i })), ...t].slice(0, TOAST_MAX))
        }
      }
      prev.current = cur
      // 내용이 바뀌었으면(건수·최근 시각 기준) 열린 화면들에 갱신 신호
      const sig = JSON.stringify(json.items.map(i => [i.key, i.count, i.at]))
      if (prevSig.current !== null && prevSig.current !== sig) window.dispatchEvent(new Event(NOTIF_CHANGED))
      prevSig.current = sig
    } catch { /* 네트워크 오류는 다음 폴링에서 */ }
  }, [])

  useEffect(() => {
    if (!enabled) return
    poll()
    const t = setInterval(poll, NOTIF_POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') poll() }
    const onReq = () => { poll() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener(NOTIF_REFRESH_REQUEST, onReq)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener(NOTIF_REFRESH_REQUEST, onReq) }
  }, [enabled, poll])

  // 토스트 자동 닫힘
  useEffect(() => {
    if (!toasts.length) return
    const timers = toasts.map(t => setTimeout(() => dismiss(t.id), TOAST_MS))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString()
    setSeenAt(now)
    try { localStorage.setItem(NOTIF_SEEN_KEY, now) } catch { /* 무시 */ }
  }, [])

  return { data, toasts, dismiss, seenAt, markAllSeen, refresh: poll }
}
