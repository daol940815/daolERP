'use client'

// 알림 확인(905, 2026-11-17) — 결과 통지(info: 수락 · 진행 메모 · 완료 확정 · 휴가 결과 · 회신 등)를 확인하면 다시 나오지 않는다.
//  저장은 서버(notification_reads)라 다른 PC에서도 같다. 해야 할 것 · 기다리는 것은 확인 대상이 아니다(일이 끝나야 사라짐).
//  화면은 누르는 즉시 숨기고(hidden), 저장이 끝나면 requestNotifRefresh() 로 종 · 다른 패널도 갱신한다.

import { useCallback, useState } from 'react'
import type { NotifItem } from '@/lib/notifications'
import { requestNotifRefresh } from '@/lib/use-notif-refresh'

export const canMarkRead = (i: NotifItem) => i.group === 'info'

export async function markNotifRead(keys: string[], all = false): Promise<string | null> {
  try {
    const res = await fetch('/api/notifications/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, all }), keepalive: true,   // 바로가기로 화면을 떠나도 저장되도록
    })
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? '확인 처리에 실패했습니다.'
    requestNotifRefresh()
    return null
  } catch { return '확인 처리에 실패했습니다(네트워크).' }
}

// 패널용 — 누른 항목을 바로 숨기고, 저장에 실패하면 되돌리고 사유를 보여준다
export function useNotifRead() {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const mark = useCallback(async (items: NotifItem[], all = false) => {
    const keys = items.filter(canMarkRead).map(i => i.key)
    if (!keys.length && !all) return
    setError(null)
    setHidden(h => new Set(Array.from(h).concat(keys)))
    const err = await markNotifRead(keys, all)
    if (err) {
      setError(err)
      setHidden(h => { const n = new Set(h); keys.forEach(k => n.delete(k)); return n })
    }
  }, [])
  const visible = useCallback((items: NotifItem[]) => items.filter(i => !hidden.has(i.key)), [hidden])
  return { mark, visible, error }
}
