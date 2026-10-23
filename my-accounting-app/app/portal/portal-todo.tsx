'use client'

// 업무 선택 화면의 "확인할 것" — 알림 API 1회 조회 (서버 컴포넌트인 portal/page.tsx에서 쓰는 클라이언트 래퍼)
import { useEffect, useState } from 'react'
import { TodoPanel } from '@/components/layout/NotificationCenter'
import type { NotifData } from '@/lib/notifications'

export default function PortalTodo() {
  const [data, setData] = useState<NotifData | null>(null)
  useEffect(() => {
    fetch('/api/notifications', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => setData(j ?? null)).catch(() => setData(null))
  }, [])
  return <TodoPanel variant="dark" data={data} />
}
