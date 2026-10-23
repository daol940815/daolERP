'use client'

// 새 업무 요청 — 담당자를 고르면 그 직원의 오늘 상황(근태 · 휴가 · 진행 중 요청 · 최근 업무일지)을 옆에 보여준다.
// 여유 계산은 하지 않는다. 마감은 필수(기본 당일 18:00), 긴급 체크 1개. 본인에게 요청 가능.
// ?from=<id> 로 들어오면(반려 건 다시 요청) 그 요청의 내용을 미리 채운다.

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { defaultDueLocal, localToIso, isoToLocal, type WrRow } from '@/lib/work-requests'
import { kstTime, LEAVE_TYPE_LABEL, type LeaveType } from '@/lib/attendance'

interface Emp { id: string; name: string; team: string | null; position: string | null; employment_type: string }
interface StaffStatus {
  today: string
  attendance: { check_in_at: string | null; check_out_at: string | null } | null
  attendanceReady: boolean
  leaves: { leave_type: LeaveType; start_date: string; end_date: string; status: string }[]
  open_count: number | null
  due_today: number
  overdue: number
  last_log: { work_date: string; content: string } | null
}

export default function NewRequestPage() {
  return <Suspense fallback={<div className="text-gray-400 text-sm p-6">로딩 중...</div>}><NewRequestForm /></Suspense>
}

function NewRequestForm() {
  const router = useRouter()
  const sp = useSearchParams()
  const [emps, setEmps] = useState<Emp[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [assignee, setAssignee] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [link, setLink] = useState('')
  const [due, setDue] = useState(() => defaultDueLocal())
  const [urgent, setUrgent] = useState(false)
  const [status, setStatus] = useState<StaffStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/work-requests/employees').then(r => r.json()).then(j => { setEmps(j.data ?? []); setMeId(j.me ?? null) }).catch(() => null)
    const from = sp.get('from')
    if (from) {
      fetch(`/api/work-requests/${from}`).then(r => r.json()).then(j => {
        const r: WrRow | undefined = j.row
        if (!r) return
        setAssignee(r.assignee?.id ?? ''); setTitle(r.title); setContent(r.content ?? ''); setLink(r.link ?? ''); setUrgent(r.is_urgent)
        if (new Date(r.due_at) > new Date()) setDue(isoToLocal(r.due_at))
      }).catch(() => null)
    }
  }, [sp])

  useEffect(() => {
    if (!assignee) { setStatus(null); return }
    fetch(`/api/work-requests/staff-status?employee_id=${assignee}`).then(r => r.json()).then(j => setStatus(j.error ? null : j)).catch(() => setStatus(null))
  }, [assignee])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    if (!assignee) { setError('담당자를 선택하세요.'); return }
    if (!title.trim()) { setError('제목을 입력하세요.'); return }
    if (!due) { setError('마감 일시를 입력하세요.'); return }
    setBusy(true)
    const res = await fetch('/api/work-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_id: assignee, title: title.trim(), content, link, due_at: localToIso(due), is_urgent: urgent }) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(json.error ?? '요청 실패'); return }
    router.push(`/me/requests/${json.id}`)
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'
  const sel = emps.find(e => e.id === assignee)
  const inT = kstTime(status?.attendance?.check_in_at ?? null)
  const outT = kstTime(status?.attendance?.check_out_at ?? null)

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/me/requests" className="text-sm text-gray-500 hover:text-gray-900">← 업무 요청</Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-1">새 요청</h1>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] mt-4">
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}
          <label className="block">
            <span className="text-xs font-medium text-gray-600">담당자 <span className="text-red-500">*</span></span>
            <select value={assignee} onChange={e => setAssignee(e.target.value)} required className={`${inputCls} mt-1 bg-white`}>
              <option value="">직원 선택</option>
              {emps.map(e => (
                <option key={e.id} value={e.id}>{e.name}{e.team ? ` · ${e.team}` : ''}{e.position ? ` ${e.position}` : ''}{e.id === meId ? ' (나)' : ''}{e.employment_type === 'parttime' ? ' · 아르바이트' : ''}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">제목 <span className="text-red-500">*</span></span>
            <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} placeholder="예: 이편한 김포 수금 독촉 통화" className={`${inputCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">내용</span>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={5} placeholder="무엇을 · 어디까지 · 결과를 어떻게 남길지" className={`${inputCls} mt-1`} />
          </label>
          <div className="flex gap-4 flex-wrap items-end">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">마감 일시 <span className="text-red-500">*</span></span>
              <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} required className={`${inputCls} mt-1 w-auto`} />
            </label>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />
              <span className={urgent ? 'text-red-600 font-semibold' : 'text-gray-700'}>긴급</span>
            </label>
            <span className="text-xs text-gray-400 pb-2">기본값 당일 18:00</span>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">관련 링크 · 서버 경로 (선택)</span>
            <input value={link} onChange={e => setLink(e.target.value)} placeholder="ERP 화면 주소, 회사 서버 경로, 문서 주소" className={`${inputCls} mt-1`} />
          </label>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">{busy ? '보내는 중...' : '요청 보내기'}</button>
            <Link href="/me/requests" className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</Link>
          </div>
        </form>

        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-5 text-sm">
          {!sel ? (
            <p className="text-gray-400">담당자를 선택하면 그 직원의 오늘 상황이 여기에 보입니다.</p>
          ) : (
            <>
              <p className="font-bold text-gray-900">{sel.name} — 오늘 상황</p>
              {!status ? <p className="text-gray-400 mt-2">불러오는 중...</p> : (
                <div className="mt-2 space-y-1.5 text-gray-700">
                  <p>근태: {!status.attendanceReady ? <span className="text-gray-400">근태 기능 준비 전</span> : inT ? <span className="text-green-700">출근 {inT}{outT ? ` · 퇴근 ${outT}` : ''}</span> : <span className="text-gray-500">출근 체크 없음</span>}</p>
                  <p>이번 주 휴가: {status.leaves.length === 0 ? <span className="text-gray-500">없음</span> : status.leaves.map((l, i) => (
                    <span key={i} className="mr-2">{l.start_date.slice(5)}{l.end_date !== l.start_date ? `~${l.end_date.slice(5)}` : ''} {LEAVE_TYPE_LABEL[l.leave_type] ?? l.leave_type}{l.status === 'requested' ? '(대기)' : ''}</span>
                  ))}</p>
                  <p>진행 중 요청: {status.open_count === null ? '-' : <b>{status.open_count}건</b>}
                    {status.open_count ? <span className="text-xs text-gray-500"> (오늘 마감 {status.due_today} · 지남 <span className={status.overdue ? 'text-red-600 font-medium' : ''}>{status.overdue}</span>)</span> : null}</p>
                  <p className="truncate">최근 업무일지: {status.last_log ? <span className="text-gray-600">{status.last_log.work_date.slice(5)} {status.last_log.content}</span> : <span className="text-gray-500">없음</span>}</p>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-4">여유 판단은 요청자가 합니다. 숫자는 근태 · 휴가 · 요청 원본에서 그대로 가져옵니다.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
