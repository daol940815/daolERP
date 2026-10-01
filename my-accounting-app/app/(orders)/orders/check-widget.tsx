'use client'

import { useCallback, useEffect, useState } from 'react'
import { kstTime } from '@/lib/attendance'

// 출퇴근 체크 위젯 — 매일 쓰는 체크만 원클릭으로, 상세(월별 기록·휴가)는 근태 · 휴가(/hr/attendance)에서.
// 모든 영역 사이드바 상단과 업무 선택 화면에 놓인다 (2026-10-01). 어두운 배경용 스타일.
// 조회 실패(미연결 계정)·비대상 직원에게는 아무것도 표시하지 않는다 — wrap 틀도 함께 숨긴다.

interface St {
  isTarget: boolean
  record: { check_in_at: string | null; check_out_at: string | null } | null
}

export default function CheckWidget({ wrap }: { wrap?: string } = {}) {
  const [st, setSt] = useState<St | null>(null)
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/attendance/status')
    if (!res.ok) { setHidden(true); return }
    setSt(await res.json())
  }, [])
  useEffect(() => { load() }, [load])

  // 퇴근은 잘못 누르기 쉬워 확인을 거치고, 눌렀어도 당일에는 본인이 취소할 수 있다 (2026-10-01 사용자 요청)
  const check = async (action: 'check_in' | 'check_out' | 'cancel_check_out') => {
    if (action === 'check_out' && !window.confirm('퇴근 체크를 하시겠습니까?\n잘못 눌렀다면 오늘 안에는 옆의 [취소]로 되돌릴 수 있습니다.')) return
    if (action === 'cancel_check_out' && !window.confirm('오늘 퇴근 체크를 취소합니다. 출근 시각은 그대로 남고 다시 퇴근 체크를 할 수 있습니다.')) return
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
  const body = (
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
        <p className="text-xs text-slate-500 px-0.5 flex items-center gap-1.5">
          <span>출근 {inTime} · 퇴근 {outTime}</span>
          <button onClick={() => check('cancel_check_out')} disabled={busy} title="퇴근을 잘못 눌렀을 때 — 오늘만 가능"
            className="ml-auto text-[11px] text-slate-400 hover:text-white underline underline-offset-2 disabled:opacity-50">취소</button>
        </p>
      )}
    </div>
  )
  return wrap ? <div className={wrap}>{body}</div> : body
}
