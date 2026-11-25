'use client'

// 알림 폴링 훅 — NOTIF_POLL_MS(60초, 보이는 탭만)마다 /api/notifications. 직전 결과와 비교해 새로 생긴(또는 건수가 늘어난) 항목을 토스트로 올린다.
// 첫 응답은 토스트 없이(로그인 직후는 '확인할 것' 패널이 담당). 확인함(seenAt)은 localStorage.
// 2026-11-18 사용자 결정: 토스트는 개수 제한 없음 · 자동으로 닫히지 않음(확인해야 닫힘). 영역을 옮기거나 새로 고쳐도 남도록 sessionStorage 에 둔다
//  (브라우저를 닫으면 사라짐 — 로그인 유지 정책과 같은 수명). 알림에서 사라진 항목(일이 끝남 · 확인함)의 토스트는 자동으로 닫는다.
//  업무 요청은 요청별 항목이라, 같은 요청에 새 상태 표시(예: 미확인 → 마감 지남)가 생기면 토스트를 다시 올린다.
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
const TOAST_STORE = 'notif-toasts'
const loadToasts = (): Toast[] => { try { const v = JSON.parse(sessionStorage.getItem(TOAST_STORE) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const saveToasts = (t: Toast[]) => { try { sessionStorage.setItem(TOAST_STORE, JSON.stringify(t)) } catch { /* 무시 */ } }
const SIGNAL_DEBOUNCE_MS = 400   // 연속 신호(수락 → 해제 등)는 한 번으로 모아 조회

export function useNotifications(enabled = true) {
  const [data, setData] = useState<NotifData | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [seenAt, setSeenAt] = useState<string | null>(null)
  const [live, setLive] = useState(false)   // Realtime 신호 연결 여부 (패널 하단 안내용)
  const prev = useRef<Map<string, { count: number; flags: string[] }> | null>(null)
  const prevSig = useRef<string | null>(null)

  useEffect(() => { try { setSeenAt(localStorage.getItem(NOTIF_SEEN_KEY)) } catch { /* 무시 */ } }, [])
  // 남아 있던 토스트 복원 (영역 이동 · 새로 고침)
  useEffect(() => { const t = loadToasts(); if (t.length) setToasts(t) }, [])
  const restored = useRef(false)
  useEffect(() => { if (restored.current) saveToasts(toasts); else restored.current = true }, [toasts])

  const dismiss = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), [])
  const dismissAll = useCallback(() => setToasts([]), [])

  // force=true 면(실시간 신호) 결과가 같아도 열린 화면에 갱신 신호를 보낸다 — 메모 추가처럼 알림 건수가 안 바뀌는 변경도 반영
  const poll = useCallback(async (force = false) => {
    let changed = false
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as NotifData
      setData(json)
      const cur = new Map(json.items.map(i => [i.key, { count: i.count, flags: i.flags ?? [] }]))
      const liveItems = new Map(json.items.map(i => [i.key, i]))
      // 새 항목 · 건수 증가 · 새 상태 표시 → 토스트 (같은 항목의 이전 토스트는 새 것으로 바꾼다)
      const fresh = !prev.current ? [] : json.items.filter(i => {
        const p = prev.current!.get(i.key)
        return !p || p.count < i.count || (i.flags ?? []).some(f => !p.flags.includes(f))
      })
      setToasts(t => {
        const kept = t.filter(x => liveItems.has(x.item.key) && !fresh.some(f => f.key === x.item.key))   // 알림에서 사라진 것은 닫는다
          .map(x => ({ ...x, item: liveItems.get(x.item.key)! }))                                         // 내용은 최신으로
        const next = [...fresh.map(i => ({ id: `${i.key}:${Date.now()}`, item: i })), ...kept]
        return next.length === t.length && next.every((x, n) => x.id === t[n].id && x.item === t[n].item) ? t : next
      })
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
    // 숨은 탭(다른 탭 · 최소화)은 폴링을 쉰다 — 돌아오면 visibilitychange 에서 즉시 한 번 조회 (2026-11-16, 서버 사용량 절감)
    const t = setInterval(() => { if (document.visibilityState === 'visible') poll() }, NOTIF_POLL_MS)
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

  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString()
    setSeenAt(now)
    try { localStorage.setItem(NOTIF_SEEN_KEY, now) } catch { /* 무시 */ }
  }, [])

  return { data, toasts, dismiss, dismissAll, seenAt, markAllSeen, refresh: () => poll(), live }
}
