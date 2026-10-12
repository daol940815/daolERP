'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL,
  type AttendanceLeave,
} from '@/lib/attendance'

// 휴가 승인 — 대기 건 결재(승인권자) + 최근 처리 내역.
// 본인 신청은 스스로 결재할 수 없다(서버에서도 차단).
// 승인된 휴가 취소는 인사·총무 수정 권한자만(2026-10-12 결정) — 사유 필수, 지난 날짜도 허용.

type LeaveRow = AttendanceLeave & { employee?: { name: string; team: string | null } | null }

export default function LeaveApprovalsPage() {
  const [pending, setPending] = useState<LeaveRow[]>([])
  const [recent, setRecent] = useState<LeaveRow[]>([])
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)   // 승인 건 취소 권한 (인사·총무 수정)
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
    setMyEmployeeId(json.myEmployeeId); setCanEdit(!!json.can_edit)
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

  // 승인된 휴가 취소 — 인사·총무 수정 권한자만. 지난 날짜도 취소할 수 있고 사유를 남긴다
  const cancelApproved = async (l: LeaveRow) => {
    const note = window.prompt(
      `${l.employee?.name ?? ''} ${LEAVE_TYPE_LABEL[l.leave_type]} (${period(l)}) 승인을 취소합니다.\n` +
      '취소 사유를 입력하세요 (필수):')
    if (note === null) return
    if (!note.trim()) { flash('취소 사유를 입력해야 합니다.'); return }
    setBusy(true)
    const res = await fetch('/api/attendance/leaves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', id: l.id, note: note.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(json.error ?? '실패'); return }
    flash('승인을 취소했습니다. 해당 날짜는 다시 근무일로 계산됩니다.')
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
        {canEdit && (
          <p className="text-xs text-gray-500 mt-1">
            승인된 휴가는 사유를 남기고 취소할 수 있습니다(지난 날짜 포함). 취소하면 그날은 다시
            근무일로 계산되어 기록이 없으면 미기록으로 표시됩니다.
          </p>
        )}
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
                <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                  {canEdit && l.status === 'approved' && (
                    <button onClick={() => cancelApproved(l)} disabled={busy}
                      className="text-xs px-2.5 py-1 border border-gray-300 rounded hover:bg-gray-50">
                      승인 취소
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!recent.length && (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm">처리 내역이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
