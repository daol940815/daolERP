'use client'

import { useEffect, useRef, useState } from 'react'

// 상태 배지 + 눌러서 보는 사유 창 (2026-11-10 사용자 결정 — 목록에서는 사유를 늘 펼치지 않는다)
//  - 주문 현황 "취소", 상담일지 목록 "종결" · "삭제됨"에 쓴다.
//  - 줄 전체가 링크인 표 안에서 쓰므로 배지를 눌러도 줄 이동은 일어나지 않는다.
//  - 바깥을 누르거나 Esc를 누르면 닫힌다.
export default function ReasonBadge({ label, cls, title, reason, by, at }: {
  label: string
  cls: string               // 배지 색 (예: 'bg-red-50 text-red-600')
  title: string             // 창 제목 (예: '취소 사유')
  reason: string | null | undefined
  by?: string | null
  at?: string | null        // ISO 시각
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const when = at
    ? new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : null
  const meta = [by, when].filter(Boolean).join(' · ')

  return (
    <span ref={ref} className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        title="눌러서 사유 보기"
        className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium underline decoration-dotted underline-offset-2 ${cls}`}>
        {label}
      </button>
      {open && (
        <span className="absolute z-20 left-0 top-full mt-1 w-64 max-w-[80vw] bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-left whitespace-normal cursor-default">
          <span className="block text-[0.6875rem] text-gray-400">{title}</span>
          <span className="block text-xs font-semibold text-gray-800 break-words">{reason || '사유 기록 없음'}</span>
          {meta && <span className="block mt-0.5 text-[0.6875rem] text-gray-500 tabular-nums">{meta}</span>}
        </span>
      )}
    </span>
  )
}
