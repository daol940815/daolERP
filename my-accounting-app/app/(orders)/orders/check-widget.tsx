'use client'

import { useCallback, useEffect, useState } from 'react'
import { kstTime } from '@/lib/attendance'

// 주문 모드 사이드바의 출퇴근 체크 위젯 — 매일 쓰는 체크만 원클릭으로,
// 상세(월별 기록·휴가)는 직원 관리 모드(/hr/attendance)에서.
// 조회 실패(미연결 계정)·비대상 직원에게는 아무것도 표시하지 않는다.

interface St {
  isTarget: boolean
  record: { check_in_at: string | null; check_out_at: string | null } | null
}

export default function CheckWidget() {
  const [st, setSt] = useState<St | null>(null)
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/attendance/status')
    if (!res.ok) { setHidden(true); return }
    setSt(await res.json())
  }, [])
  useEffect(() => { load() }, [load])

  const check = async (action: 'check_in' | 'check_out') => {
    setBusy(true)
    const res = await fetch('/api/attendance/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    })
    setBusy(false)
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? '실패'); return }
    load()
  }

  if (hidden || !st || !st.isTarget) return null

  const inTime = kstTime(st.record?.check_in_at ?? null)
  const outTime = kstTime(st.record?.check_out_at ?? null)
  return (
    <div className="px-3 mb-1.5">
      {!inTime ? (
        <button onClick={() => check('check_in')} disabled={busy}
          className="w-full px-3 py-2 bg-white/10 text-white rounded-lg text-sm font-medium hover:bg-white/20 disabled:opacity-50">
          출근 체크
        </button>
      ) : !outTime ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 shrink-0">출근 {inTime}</span>
          <button onClick={() => check('check_out')} disabled={busy}
            className="flex-1 px-2 py-1.5 bg-white/10 text-white rounded-lg text-xs font-medium hover:bg-white/20 disabled:opacity-50">
            퇴근 체크
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 px-0.5">출근 {inTime} · 퇴근 {outTime}</p>
      )}
    </div>
  )
}
