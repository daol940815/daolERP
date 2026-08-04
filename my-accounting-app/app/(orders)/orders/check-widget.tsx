'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { kstTime } from '@/lib/attendance'

// 주문 모드 헤더의 출퇴근 체크 위젯 — 매일 쓰는 체크만 원클릭으로,
// 상세(월별 기록·휴가)는 직원 관리 모드(/hr/attendance)에서

interface St {
  isTarget: boolean
  record: { check_in_at: string | null; check_out_at: string | null } | null
}

export default function CheckWidget() {
  const [st, setSt] = useState<St | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/attendance/status')
    if (!res.ok) { setFailed(true); return }
    setSt(await res.json())
  }, [])
  useEffect(() => { load() }, [load])

  const check = async (action: 'check_in' | 'check_out') => {
    setBusy(true)
    const res = await fetch('/api/attendance/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    })
    setBusy(false)
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '실패') ; return }
    load()
  }

  const link = (
    <Link href="/hr/attendance" className="text-xs text-slate-300 hover:text-white">근태</Link>
  )
  // 미연결 계정 등 조회 실패·비대상은 링크만 노출
  if (failed || (st && !st.isTarget)) return link
  if (!st) return null

  const inTime = kstTime(st.record?.check_in_at ?? null)
  const outTime = kstTime(st.record?.check_out_at ?? null)
  return (
    <span className="flex items-center gap-2">
      {!inTime ? (
        <button onClick={() => check('check_in')} disabled={busy}
          className="text-xs px-2.5 py-1 bg-white/15 text-white rounded hover:bg-white/25 disabled:opacity-50">
          출근 체크
        </button>
      ) : !outTime ? (<>
        <span className="text-xs text-slate-400">출근 {inTime}</span>
        <button onClick={() => check('check_out')} disabled={busy}
          className="text-xs px-2.5 py-1 bg-white/15 text-white rounded hover:bg-white/25 disabled:opacity-50">
          퇴근 체크
        </button>
      </>) : (
        <span className="text-xs text-slate-400">출근 {inTime} · 퇴근 {outTime}</span>
      )}
      {link}
    </span>
  )
}
