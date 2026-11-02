'use client'

// 알림 폴링 훅 — NOTIF_POLL_MS(20초)마다 /api/notifications. 직전 결과와 비교해 새로 생긴(또는 건수가 늘어난) 항목을 토스트로 올린다.
// 첫 응답은 토스트 없이(로그인 직후는 '확인할 것' 패널이 담당). 확인함(seenAt)은 localStorage.
// 결과가 직전과 달라지면 window 이벤트(NOTIF_CHANGED)를 쏴서 열린 화면(업무 요청 목록·상세·대시보드)이 자기 데이터를 다시 조회한다.
// 화면 조작 뒤 requestNotifRefresh() 가 오면 즉시 한 번 폴링한다. (⑥ 1단계, 2026-11-02)
// ⑥ 2단계: Supabase Realtime 채널 'wr' 의 'changed' 신호를 받으면 1~2초 안에 즉시 폴링 + 열린 화면 갱신. 폴링은 안전망으로 유지.
//   신호에는 데이터가 없고(요청 id·직원 id), 실제 데이터는 권한 검사를 거치는 기존 API로만 받는다.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import { NOTIF_POLL_MS, NOTIF_SEEN_KEY, WR_CHANNEL, WR_EVENT, type NotifData, type NotifItem } from '@/lib/notifications'
import { NOTIF_CHANGED, NOTIF_REFRESH_REQUEST } from '@/lib/use-notif-refresh'

export interface Toast { id: string; item: NotifItem }
const TOAST_MS = 8000
const TOAST_MAX = 2
const SIGNAL_DEBOUNCE_MS = 400   // 연속 신호(수락 → 해제 등)는 한 번으로 모아 조회

export function useNotifications(enabled = true) {
  const [data, setData] = useState<NotifData | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [seenAt, setSeenAt] = useState<string | null>(null)
  const [live, setLive] = useState(false)   // Realtime 신호 연결 여부 (패널 하단 안내용)
  const prev = useRef<Map<string, number> | null>(null)
  const prevSig = useRef<string | null>(null)

  useEffect(() => { try { setSeenAt(localStorage.getItem(NOTIF_SEEN_KEY)) } catch { /* 무시 */ } }, [])

  const dismiss = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), [])

  // force=true 면(실시간 신호) 결과가 같아도 열린 화면에 갱신 신호를 보낸다 — 메모 추가처럼 알림 건수가 안 바뀌는 변경도 반영
  const poll = useCallback(async (force = false) => {
    let changed = false
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
      changed = prevSig.current !== null && prevSig.current !== sig
      prevSig.current = sig
    } catch { /* 네트워크 오류는 다음 폴링에서 */ }
    if (changed || force) window.dispatchEvent(new Event(NOTIF_CHANGED))
  }, [])

  useEffect(() => {
    if (!enabled) return
    poll()
    const t = setInterval(() => poll(), NOTIF_POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') poll() }
    const onReq = () => { poll() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener(NOTIF_REFRESH_REQUEST, onReq)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener(NOTIF_REFRESH_REQUEST, onReq) }
  }, [enabled, poll])

  // Realtime 신호 구독 (⑥ 2단계) — 신호가 오면 디바운스 후 즉시 폴링 + 화면 갱신. 연결 실패 시 조용히 폴링만.
  useEffect(() => {
    if (!enabled) return
    let channel: RealtimeChannel | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let supa: ReturnType<typeof createClient> | null = null
    try {
      supa = createClient()
      channel = supa.channel(WR_CHANNEL)
        .on('broadcast', { event: WR_EVENT }, () => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => { timer = null; poll(true) }, SIGNAL_DEBOUNCE_MS)
        })
        .subscribe(status => setLive(status === 'SUBSCRIBED'))
    } catch { setLive(false) }
    return () => {
      if (timer) clearTimeout(timer)
      if (channel && supa) supa.removeChannel(channel).catch(() => null)
      setLive(false)
    }
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

  return { data, toasts, dismiss, seenAt, markAllSeen, refresh: () => poll(), live }
}
