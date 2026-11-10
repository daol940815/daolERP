'use client'

import { REASON_OTHER } from '@/lib/cancel-reasons'

// 사유 빠른 선택 + 직접 입력 (주문 취소 · 상담 종결 · 상담 삭제 공용, 2026-11-10)
//  - 버튼은 하나만 고른다 (다시 누르면 해제). '기타'면 아래 칸이 필수.
//  - 저장 값 조합은 lib/cancel-reasons.ts composeReason
export default function ReasonPicker({ options, picked, onPick, text, onText, placeholder, multiline }: {
  options: readonly string[]
  picked: string | null
  onPick: (v: string | null) => void
  text: string
  onText: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const needText = picked === REASON_OTHER && !text.trim()
  const field = `w-full border rounded-lg px-3 py-1.5 text-sm bg-white ${needText ? 'border-red-400' : 'border-gray-300'}`
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {options.map(o => (
          <button key={o} type="button" onClick={() => onPick(picked === o ? null : o)} aria-pressed={picked === o}
            className={`px-2.5 py-1 rounded-full text-xs border ${picked === o ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}>
            {o}
          </button>
        ))}
      </div>
      {multiline ? (
        <textarea value={text} onChange={e => onText(e.target.value)} rows={2} maxLength={300}
          placeholder={placeholder ?? '자세한 사유 (기타를 고르면 필수)'} className={field} />
      ) : (
        <input value={text} onChange={e => onText(e.target.value)} maxLength={300}
          placeholder={placeholder ?? '자세한 사유 (기타를 고르면 필수)'} className={field} />
      )}
      {needText && <div className="text-[0.6875rem] text-red-600">기타를 고르셨으면 사유를 적어 주세요.</div>}
    </div>
  )
}
