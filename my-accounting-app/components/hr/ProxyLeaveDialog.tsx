'use client'

import { useState } from 'react'
import { LEAVE_TYPE_LABEL, REQUEST_LEAVE_TYPES, type LeaveType } from '@/lib/attendance'

import { btnCls } from '@/components/ui/kit'
// 휴가 대리 등록 (207, 2026-11-18 결정 A) — 인사 · 총무 수정 권한자가 로그인 계정 없는 직원(다른 법인 등)의 휴가를 넣는다.
// 3단계 결재를 건너뛰고 바로 승인되며, 결재 칸에 "대리 등록 · 등록자"가 남는다. 휴가 목록 · 연차 관리에서 같이 쓴다.

export interface ProxyEmp { id: string; name: string; team: string | null; has_login: boolean }

export default function ProxyLeaveDialog({ employees, onClose, onDone }: {
  employees: ProxyEmp[]
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [f, setF] = useState({ employee_id: '', leave_type: 'annual' as LeaveType, start_date: '', end_date: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const sorted = [...employees].sort((a, b) => Number(a.has_login) - Number(b.has_login) || a.name.localeCompare(b.name, 'ko'))

  const submit = async () => {
    if (!f.employee_id) { setErr('직원을 고르세요.'); return }
    if (!f.start_date) { setErr('시작일을 입력하세요.'); return }
    setBusy(true); setErr(null)
    const res = await fetch('/api/attendance/leaves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'proxy_register', ...f, end_date: f.end_date || f.start_date }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(json.error ?? '등록 실패'); return }
    const name = employees.find(e => e.id === f.employee_id)?.name ?? ''
    onDone(`${name} ${LEAVE_TYPE_LABEL[f.leave_type]} ${json.days ?? ''}일을 대리 등록했습니다(승인 처리).`)
  }
  const inp = 'w-full border border-slate-400 rounded-lg px-2 py-1.5 text-sm'
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-40 flex items-start justify-center pt-24" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-w-[95vw] p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold text-slate-900">휴가 대리 등록</h2>
        <p className="text-xs text-slate-600 mt-1">로그인 계정이 없는 직원의 휴가를 인사 · 총무가 대신 넣습니다. 결재 없이 바로 승인되고, 등록한 사람이 기록됩니다.</p>
        {err && <div className="mt-3 px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{err}</div>}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="col-span-2">
            <label className="block text-xs text-slate-600 font-semibold mb-1">직원</label>
            <select value={f.employee_id} onChange={e => setF(s => ({ ...s, employee_id: e.target.value }))} className={inp}>
              <option value="">선택…</option>
              {sorted.map(e => <option key={e.id} value={e.id}>{e.name}{e.team ? ` · ${e.team}` : ''}{e.has_login ? '' : ' (계정 없음)'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 font-semibold mb-1">종류</label>
            <select value={f.leave_type} onChange={e => setF(s => ({ ...s, leave_type: e.target.value as LeaveType }))} className={inp}>
              {REQUEST_LEAVE_TYPES.map(t => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 font-semibold mb-1">사유 (선택)</label>
            <input value={f.reason} onChange={e => setF(s => ({ ...s, reason: e.target.value }))} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-slate-600 font-semibold mb-1">시작일</label>
            <input type="date" value={f.start_date} onChange={e => setF(s => ({ ...s, start_date: e.target.value }))} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-slate-600 font-semibold mb-1">종료일 (비우면 하루)</label>
            <input type="date" value={f.end_date} onChange={e => setF(s => ({ ...s, end_date: e.target.value }))} className={inp} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 border border-slate-400 rounded-lg text-sm">닫기</button>
          <button onClick={submit} disabled={busy} className={btnCls('primary', 'md')}>
            {busy ? '등록 중…' : '대리 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
