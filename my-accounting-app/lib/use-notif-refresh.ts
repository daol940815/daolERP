'use client'

// 알림 변경 신호 — 화면 자동 갱신(업무요청 트랙 ⑥ 1단계, 2026-11-02).
// useNotifications(AreaSidebar)가 폴링 결과가 직전과 달라졌을 때 window 이벤트 NOTIF_CHANGED 를 쏘고,
// 업무 요청 목록·상세·대시보드 등은 useNotifRefresh(load) 로 그 신호를 받아 자기 데이터를 다시 조회한다.
// 반대로 화면에서 수락·보고 같은 조작을 하면 requestNotifRefresh() 로 즉시 폴링을 요청해 종·배지가 바로 바뀐다.

import { useEffect, useRef } from 'react'

export const NOTIF_CHANGED = 'daol:notif-changed'
export const NOTIF_REFRESH_REQUEST = 'daol:notif-refresh'

export function useNotifRefresh(onChange: () => void) {
  const ref = useRef(onChange)
  ref.current = onChange
  useEffect(() => {
    const h = () => ref.current()
    window.addEventListener(NOTIF_CHANGED, h)
    return () => window.removeEventListener(NOTIF_CHANGED, h)
  }, [])
}

export const requestNotifRefresh = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIF_REFRESH_REQUEST)) }
