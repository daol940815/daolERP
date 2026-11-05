'use client'

import {
  STEPS, STEP_TONE_CLASS, stepCell,
  type ApproverRoster, type LeaveStep,
} from '@/lib/leave-approval'

// 휴가 결재 진행 칸 — 1차 · 2차 · 3차 (204). 휴가 목록 · 내 근태가 같이 쓴다.
// 이력이 없는 승인 건은 3단계 결재 도입 전 승인(기존 방식)으로 표시한다.

export default function LeaveSteps({ steps, status, myTurn, roster, applicantId, decidedByName, stepsReady }: {
  steps: LeaveStep[]
  status: string
  myTurn?: boolean
  roster?: ApproverRoster
  applicantId?: string
  decidedByName?: string | null
  stepsReady: boolean
}) {
  if (!stepsReady || (!steps.length && status !== 'requested')) {
    if (status === 'requested') return <span className="text-[0.6875rem] text-amber-700">승인 대기</span>
    if (status === 'canceled' && !steps.length) return <span className="text-[0.6875rem] text-gray-400">-</span>
    return (
      <span className="inline-block rounded-md border border-gray-200 bg-slate-50 text-slate-500 text-[0.65625rem] px-1.5 py-0.5">
        {stepsReady ? '기존 방식 ' : ''}{status === 'rejected' ? '반려' : '승인'}{decidedByName ? ` · ${decidedByName}` : ''}
      </span>
    )
  }
  return (
    <div className="flex gap-0.5">
      {STEPS.map(st => {
        const c = stepCell(st, steps, status, { myTurn, roster, applicantId })
        return (
          <span key={st} className={`rounded-md border px-1.5 py-0.5 text-[0.65625rem] leading-tight min-w-[64px] max-w-[120px] truncate ${STEP_TONE_CLASS[c.tone]}`}
            title={`${st}차 ${c.text}`}>
            <b className="block text-[0.59375rem] font-bold opacity-70">{st}차</b>
            {c.text}
          </span>
        )
      })}
    </div>
  )
}
