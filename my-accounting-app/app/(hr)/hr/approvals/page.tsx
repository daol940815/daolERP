'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL,
  type AttendanceLeave,
} from '@/lib/attendance'

// 휴가 승인 (중간 관리자·전체 관리자) — 대기 건 결재 + 최근 처리 내역
// 중간 관리자는 본인 신청을 스스로 결재할 수 없다 (서버에서도 차단)

type LeaveRow = AttendanceLeave & { employee?: { name: string; team: string | null } | null }

export default function LeaveApprovalsPage() {
  const [pending, setPending] = useState<LeaveRow[]>([])
  const [recent, setRecent] = useState<LeaveRow[]>([])
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/attendance/leaves?scope=all')
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setError(json.error ?? '조회 실패'); return }
    setError(null)
    const rows = json.leaves as LeaveRow[]
    setPending(rows.filter(l => l.status === 'requested'))
    setRecent(rows.filter(l => l.status !== 'requested').slice(0, 50))
    setMyEmployeeId(json.myEmployeeId)
  }, [])
  useEffect(() => { load() }, [load])

  const decide = async (id: string, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? (window.prompt('반려 사유를 입력하세요 (선택):') ?? '') : ''
    setBusy(true)
    const res = await fetch('/api/attendance/leaves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, note }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); return }
    flash(action === 'approve' ? '승인했습니다.' : '반려했습니다.')
    load()
  }

  const period = (l: LeaveRow) =>
    `${l.start_date}${l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ''}`

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900">휴가 승인</h1>
      {msg && <div className="my-3 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {error && <div className="my-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl mt-4 p-4">
        <h2 className="font-bold text-gray-900">승인 대기 <span className="text-sm text-amber-600">{pending.length}건</span></h2>
        {loading ? <div className="text-center py-10 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm mt-2">
            <tbody>
              {pending.map(l => (
                <tr key={l.id} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 font-semibold">{l.employee?.name ?? '-'}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{l.employee?.team ?? ''}</td>
                  <td className="py-1.5 px-3 font-medium">{LEAVE_TYPE_LABEL[l.leave_type]}</td>
                  <td className="py-1.5 px-3 tabular-nums text-xs">{period(l)}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{l.reason ?? ''}</td>
                  <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                    {l.employee_id === myEmployeeId ? (
                      <span className="text-[11px] text-gray-400">본인 신청</span>
                    ) : (<>
                      <button onClick={() => decide(l.id, 'approve')} disabled={busy}
                        className="text-xs px-2.5 py-1 bg-slate-900 text-white rounded mr-1 hover:bg-slate-700">승인</button>
                      <button onClick={() => decide(l.id, 'reject')} disabled={busy}
                        className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50">반려</button>
                    </>)}
                  </td>
                </tr>
              ))}
              {!pending.length && (
                <tr><td className="py-8 text-center text-gray-400 text-sm">대기 중인 신청이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl mt-4 p-4">
        <h2 className="font-bold text-gray-900">최근 처리 내역</h2>
        <table className="w-full text-sm mt-2">
          <tbody>
            {recent.map(l => (
              <tr key={l.id} className="border-b border-gray-50">
                <td className="py-1.5 pr-3 font-semibold">{l.employee?.name ?? '-'}</td>
                <td className="py-1.5 px-3 font-medium">{LEAVE_TYPE_LABEL[l.leave_type]}</td>
                <td className="py-1.5 px-3 tabular-nums text-xs">{period(l)}</td>
                <td className="py-1.5 px-3">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                    l.status === 'approved' ? 'bg-green-100 text-green-700'
                    : l.status === 'rejected' ? 'bg-red-100 text-red-600'
                    : 'bg-gray-100 text-gray-500'}`}>
                    {LEAVE_STATUS_LABEL[l.status]}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-xs text-gray-400">{l.decide_note ?? ''}</td>
              </tr>
            ))}
            {!recent.length && (
              <tr><td className="py-8 text-center text-gray-400 text-sm">처리 내역이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
